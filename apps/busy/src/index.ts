import type { DisplayElements } from '@busy-app/busy-lib';
import type { Result } from 'better-result';
import { createRequestLogger } from 'evlog';
import { type EvlogVariables, evlog } from 'evlog/hono';
import { initWorkersLogger } from 'evlog/workers';
import { type Context, Hono } from 'hono';
import * as z from 'zod/mini';
import * as debug from './adapters/debug';
import * as litterbot from './adapters/litterbot';
import * as spotify from './adapters/spotify';
import * as busybar from './features/busybar';
import * as connections from './features/connections';
import * as devices from './features/devices';
import * as litterbot_api from './features/litterbot';
import * as spotify_api from './features/spotify';
import { DEFAULT_USER_ID, ensure_default } from './features/users';
import * as workflow from './features/workflow';
import {
  type Env,
  litterbot_poll_url,
  parse_env,
  spotify_poll_url,
  spotify_redirect_uri,
  workflow_url,
} from './lib/env';
import {
  type app_error,
  ConnectionLinkFailed,
  DeviceHasNoToken,
  DeviceNotFound,
  error_fields,
  error_status,
  QueryInvalid,
  SpotifyMissingRefreshToken,
} from './lib/errors';
import { busy_event_schema } from './lib/events';
import { with_db } from './lib/prisma';
import { read_json_body } from './lib/request';
import { make_qstash } from './lib/upstash';
import { render_page } from './ui';

type app_env = { Bindings: Env } & EvlogVariables;
type app_context = Context<app_env>;

// Emit wide events as objects (not JSON strings) with Workers-native severity so
// Cloudflare Logs indexes their fields for querying. Module scope, once.
initWorkersLogger({ env: { service: 'busy' }, stringify: false });

const app = new Hono<app_env>();
const api = new Hono<app_env>();

app.use(evlog());

/*
 * The single boundary that turns any tagged failure mode into an HTTP response.
 * The full structured context of the failure (tag, endpoint, upstream status,
 * device_id, ...) is folded into the request's wide event so one queryable line
 * explains the whole request, then mapped to its status via `error_status`.
 */
function fail(c: app_context, error: app_error): Response {
  const status = error_status(error);
  c.get('log').set({
    outcome: 'error',
    status,
    error: error_fields(error),
  });
  const body =
    error._tag === 'BodyInvalid'
      ? { error: error.message, issues: error.issues }
      : { error: error.message };
  return c.json(body, status);
}

/*
 * Runs `waitUntil` background work as its own wide-event span: the response has
 * already been sent, so this work is out of band of the request event. Each task
 * opens a standalone logger (structured, drained, one event) instead of a bare
 * `console.warn`, correlated by `operation` and the caller's identifying fields.
 */
function run_background<E extends { _tag: string; message: string }>(
  ctx: { waitUntil: (promise: Promise<unknown>) => void },
  operation: string,
  fields: Record<string, unknown>,
  work: Promise<Result<unknown, E>>,
): void {
  const log = createRequestLogger({
    path: operation,
    waitUntil: ctx.waitUntil.bind(ctx),
  });
  log.set({ operation, ...fields });
  ctx.waitUntil(
    work.then((r) => {
      if (r.isErr())
        log.error(r.error.message, {
          outcome: 'error',
          error: { tag: r.error._tag },
        });
      else log.set({ outcome: 'ok' });
      log.emit();
    }),
  );
}

/*
 * Fold a poll cycle into the wide event under a dedicated `poll` namespace so it
 * never collides with the request-level `outcome`. High-cardinality ids
 * (connection_id, event_id) and the upstream `reason` — which otherwise only
 * reaches the ack body qstash reads and discards — become queryable fields.
 */
function poll_fields(
  type: 'spotify' | 'litterbot',
  payload: { connection_id: string; event_id: string },
  outcome: { status: string; reason?: string },
): Record<string, unknown> {
  return {
    poll: {
      type,
      connection_id: payload.connection_id,
      event_id: payload.event_id,
      outcome: outcome.status,
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    },
  };
}

function spotify_config(env: Env): spotify_api.config {
  return {
    client_id: env.SPOTIFY_CLIENT_ID,
    client_secret: env.SPOTIFY_CLIENT_SECRET,
    redirect_uri: spotify_redirect_uri(env),
  };
}

const device_input_schema = z.object({
  name: z.optional(z.nullable(z.string())),
  access_token: z.optional(z.string()),
});

const draw_element_schema = z.custom<DisplayElements['elements'][number]>(
  (v) => typeof v === 'object' && v !== null && 'id' in v && 'type' in v,
);

const debug_ingest_schema = z.object({
  device_id: z.string(),
  priority: z.optional(z.number()),
  elements: z.array(draw_element_schema),
});

const spotify_poll_schema = z.object({
  connection_id: z.string(),
  event_id: z.string(),
});

const litterbot_login_schema = z.object({
  username: z.string(),
  password: z.string(),
});

const litterbot_poll_schema = z.object({
  connection_id: z.string(),
  event_id: z.string(),
});

function poll_deps(env: Env, config: spotify_api.config): spotify.poll_deps {
  return {
    qstash: make_qstash(env),
    poll_url: spotify_poll_url(env),
    workflow_url: workflow_url(env),
    config,
  };
}

function litterbot_deps(env: Env): litterbot.poll_deps {
  return {
    qstash: make_qstash(env),
    poll_url: litterbot_poll_url(env),
    workflow_url: workflow_url(env),
  };
}

api.get('/healthcheck', (c) => c.text('OK', 200));

api.get('/devices', async (c) => {
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const list = await with_db(env.value.DATABASE_URL, (rt) => devices.all(rt));
  if (list.isErr()) return fail(c, list.error);
  c.get('log').set({ device_count: list.value.length });
  return c.json(
    list.value.map((d) => ({
      id: d.id,
      name: d.name,
      busybar: d.access_token !== null,
    })),
  );
});

api.get('/connections', async (c) => {
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const config = spotify_config(c.env);
  const log = c.get('log');
  const list = await with_db(env.value.DATABASE_URL, async (rt) =>
    Promise.all(
      (await connections.all(rt)).map(async (conn) => {
        if (conn.type === 'spotify') {
          const profile = await spotify.profile(rt, conn, config);
          if (profile.isErr())
            log.warn('spotify profile lookup degraded', {
              spotify_profile_error: profile.error._tag,
            });
          const p = profile.unwrapOr(null);
          return {
            id: conn.id,
            type: 'spotify' as const,
            display_name: p?.display_name ?? null,
            image_url: p?.image_url ?? null,
          };
        }
        if (conn.type === 'litterbot') {
          return {
            id: conn.id,
            type: 'litterbot' as const,
            linked: conn.refresh_token !== null,
          };
        }
        return { id: conn.id, type: conn.type };
      }),
    ),
  );
  if (list.isErr()) return fail(c, list.error);
  return c.json(list.value);
});

api.post('/devices', async (c) => {
  const input = await read_json_body(c, device_input_schema);
  if (input.isErr()) return fail(c, input.error);
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const device = await with_db(env.value.DATABASE_URL, (rt) =>
    devices.create(rt, input.value),
  );
  if (device.isErr()) return fail(c, device.error);
  const token = device.value.access_token;
  if (token !== null)
    run_background(
      c.executionCtx,
      'background:sync_assets',
      { device_id: device.value.id },
      busybar.sync_assets(token),
    );
  return c.json(devices.redact(device.value), 201);
});

api.post('/devices/:id/refresh', async (c) => {
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const id = c.req.param('id');
  const device = await with_db(env.value.DATABASE_URL, (rt) =>
    devices.get(rt, id),
  );
  if (device.isErr()) return fail(c, device.error);
  if (!device.value)
    return fail(
      c,
      new DeviceNotFound({ message: `device ${id} not found`, device_id: id }),
    );
  if (device.value.access_token === null)
    return fail(
      c,
      new DeviceHasNoToken({
        message: `device ${id} has no busy bar token`,
        device_id: id,
      }),
    );
  const synced = await busybar.sync_assets(device.value.access_token);
  if (synced.isErr()) return fail(c, synced.error);
  return c.json({ refreshed: true }, 200);
});

api.post('/devices/:id', async (c) => {
  const input = await read_json_body(c, device_input_schema);
  if (input.isErr()) return fail(c, input.error);
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const id = c.req.param('id');
  const device = await with_db(env.value.DATABASE_URL, (rt) =>
    devices.update(rt, id, input.value),
  );
  if (device.isErr()) return fail(c, device.error);
  if (!device.value)
    return fail(
      c,
      new DeviceNotFound({ message: `device ${id} not found`, device_id: id }),
    );
  const token = device.value.access_token;
  if (input.value.access_token !== undefined && token !== null)
    run_background(
      c.executionCtx,
      'background:sync_assets',
      { device_id: device.value.id },
      busybar.sync_assets(token),
    );
  return c.json(devices.redact(device.value));
});

api.get('/devices/:id', async (c) => {
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const id = c.req.param('id');
  const device = await with_db(env.value.DATABASE_URL, (rt) =>
    devices.get(rt, id),
  );
  if (device.isErr()) return fail(c, device.error);
  if (!device.value)
    return fail(
      c,
      new DeviceNotFound({ message: `device ${id} not found`, device_id: id }),
    );
  return c.json(devices.redact(device.value));
});

api.get('/connections/spotify/authorize', async (c) => {
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const config = spotify_config(c.env);
  const user_id = await with_db(env.value.DATABASE_URL, (rt) =>
    ensure_default(rt),
  );
  if (user_id.isErr()) return fail(c, user_id.error);
  return c.redirect(spotify_api.authorize_url(config, user_id.value));
});

api.get('/connections/spotify/callback', async (c) => {
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const config = spotify_config(c.env);
  const code = c.req.query('code');
  const user_id = c.req.query('state') ?? DEFAULT_USER_ID;
  if (!code)
    return fail(
      c,
      new QueryInvalid({
        message:
          'spotify callback is missing the required `code` query parameter',
      }),
    );

  const token = await spotify_api.exchange_code(config, code);
  if (token.isErr()) return fail(c, token.error);
  if (!token.value.refresh_token)
    return fail(
      c,
      new SpotifyMissingRefreshToken({
        message: 'spotify did not return a refresh token',
      }),
    );
  const refresh_token = token.value.refresh_token;

  const updated = await with_db(env.value.DATABASE_URL, (rt) =>
    connections.set_spotify_auth(rt, user_id, {
      refresh_token,
      access_token: token.value.access_token,
      expires_at: new Date(Date.now() + token.value.expires_in * 1000),
    }),
  );
  if (updated.isErr()) return fail(c, updated.error);
  if (!updated.value)
    return fail(
      c,
      new ConnectionLinkFailed({ message: 'could not link spotify' }),
    );
  return c.redirect('/');
});

api.post('/connections/litterbot', async (c) => {
  const input = await read_json_body(c, litterbot_login_schema);
  if (input.isErr()) return fail(c, input.error);
  const token = await litterbot_api.login(
    input.value.username,
    input.value.password,
  );
  if (token.isErr()) return fail(c, token.error);
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const updated = await with_db(env.value.DATABASE_URL, async (rt) => {
    const user_id = await ensure_default(rt);
    return connections.set_litterbot_auth(rt, user_id, {
      access_token: token.value.access_token,
      refresh_token: token.value.refresh_token,
      expires_at: new Date(Date.now() + token.value.expires_in * 1000),
    });
  });
  if (updated.isErr()) return fail(c, updated.error);
  if (!updated.value)
    return fail(
      c,
      new ConnectionLinkFailed({ message: 'could not link litter robot' }),
    );
  return c.json({ linked: true }, 201);
});

api.post('/workflows/litterbot-poll', async (c) => {
  const input = await read_json_body(c, litterbot_poll_schema);
  if (input.isErr()) return fail(c, input.error);
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const outcome = (
    await with_db(env.value.DATABASE_URL, (rt) =>
      litterbot.handle_poll(rt, litterbot_deps(env.value), input.value),
    )
  ).andThen((r) => r);
  if (outcome.isErr()) return fail(c, outcome.error);
  c.get('log').set(poll_fields('litterbot', input.value, outcome.value));
  return c.json(outcome.value, 200);
});

api.post('/ingest/debug', async (c) => {
  const input = await read_json_body(c, debug_ingest_schema);
  if (input.isErr()) return fail(c, input.error);
  const event = debug.ingest(input.value);
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const qstash = make_qstash(env.value);
  const url = workflow_url(env.value);
  run_background(
    c.executionCtx,
    'background:enqueue_debug',
    { device_id: event.device_id },
    workflow.enqueue(qstash, url, event),
  );
  return c.json({ queued: event.device_id }, 202);
});

api.post('/workflows/spotify-poll', async (c) => {
  const input = await read_json_body(c, spotify_poll_schema);
  if (input.isErr()) return fail(c, input.error);
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const config = spotify_config(c.env);
  const outcome = (
    await with_db(env.value.DATABASE_URL, (rt) =>
      spotify.handle_poll(rt, poll_deps(env.value, config), input.value),
    )
  ).andThen((r) => r);
  if (outcome.isErr()) return fail(c, outcome.error);
  c.get('log').set(poll_fields('spotify', input.value, outcome.value));
  return c.json(outcome.value, 200);
});

api.post('/workflows/event', async (c) => {
  const input = await read_json_body(c, busy_event_schema);
  if (input.isErr()) return fail(c, input.error);
  const env = parse_env(c.env);
  if (env.isErr()) return fail(c, env.error);
  const result = await with_db(env.value.DATABASE_URL, (rt) =>
    workflow.handle(rt, input.value),
  );
  // Genuine infra faults (DB access) surface as 500 so this FIFO qstash queue
  // retries. Every other draw outcome is acked (2xx): a non-2xx makes qstash
  // head-of-line-block the queue, and none of these are fixed by retrying the
  // same now-stale frame — the next poll enqueues a fresh one.
  if (result.isErr()) return fail(c, result.error);
  const log = c.get('log');
  log.set({
    event: { type: input.value.type, device_id: input.value.device_id },
    draw: result.value.status,
  });
  if (result.value.status === 'draw_failed')
    log.warn('draw failed', {
      device_id: input.value.device_id,
      draw_error: result.value.message,
    });
  return c.json(result.value, 200);
});

/*
 * Scheduled cron job. Runs outside the HTTP surface, so it opens its own wide
 * event via `createRequestLogger` and emits once with the per-connection
 * outcomes. A misconfigured env or DB fault is recorded and rethrown so the
 * platform marks the invocation failed.
 *
 * @see `triggers` in ./wrangler.toml
 */
async function scheduled(
  _event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const log = createRequestLogger({
    path: 'cron:poll',
    waitUntil: ctx.waitUntil.bind(ctx),
  });
  const parsed = parse_env(env);
  if (parsed.isErr()) {
    log.error(parsed.error.message, { error: { tag: parsed.error._tag } });
    log.emit();
    throw parsed.error;
  }
  const config = spotify_config(parsed.value);
  const spotify_deps = poll_deps(parsed.value, config);
  const lb_deps = litterbot_deps(parsed.value);

  const outcomes: {
    type: 'spotify' | 'litterbot';
    id: string;
    status: 'ok' | 'error';
    error_tag?: string;
  }[] = [];
  const result = await with_db(parsed.value.DATABASE_URL, async (rt) => {
    for (const conn of await connections.all(rt)) {
      if (conn.type === 'spotify') {
        const armed = await spotify.ensure_scheduled(rt, spotify_deps, conn);
        if (armed.isErr())
          log.warn('spotify arm failed', { connection_id: conn.id });
        outcomes.push({
          type: 'spotify',
          id: conn.id,
          status: armed.isErr() ? 'error' : 'ok',
          ...(armed.isErr() ? { error_tag: armed.error._tag } : {}),
        });
      } else if (conn.type === 'litterbot') {
        const armed = await litterbot.ensure_scheduled(rt, lb_deps, conn);
        if (armed.isErr())
          log.warn('litterbot arm failed', { connection_id: conn.id });
        outcomes.push({
          type: 'litterbot',
          id: conn.id,
          status: armed.isErr() ? 'error' : 'ok',
          ...(armed.isErr() ? { error_tag: armed.error._tag } : {}),
        });
      }
    }
  });
  // Record how far the loop got even when the DB fault aborts it mid-run — that
  // is exactly the invocation where the partial progress matters.
  log.set({ connections: outcomes });
  if (result.isErr()) {
    log.error(result.error.message, {
      outcome: 'error',
      error: { tag: result.error._tag },
    });
    log.emit();
    throw result.error;
  }
  log.emit();
}

app.get('/', (c) => c.html(render_page()));
app.route('/api', api);

export default { fetch: app.fetch, scheduled };
