import type { DisplayElements } from '@busy-app/busy-lib';
import { Hono } from 'hono';
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
import { busy_event_schema } from './lib/events';
import { with_db } from './lib/prisma';
import { make_qstash } from './lib/upstash';
import { render_page } from './ui';

const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();

function spotify_config(env: Env): spotify_api.config | null {
  const redirect_uri = spotify_redirect_uri(env);

  return {
    client_id: env.SPOTIFY_CLIENT_ID,
    client_secret: env.SPOTIFY_CLIENT_SECRET,
    redirect_uri,
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
  const list = await with_db(env.DATABASE_URL, (rt) => devices.all(rt));
  return c.json(
    list.map((d) => ({
      id: d.id,
      name: d.name,
      busybar: d.access_token !== null,
    })),
  );
});

api.get('/connections', async (c) => {
  const env = parse_env(c.env);
  const config = spotify_config(c.env);
  const list = await with_db(env.DATABASE_URL, async (rt) =>
    Promise.all(
      (await connections.all(rt)).map(async (conn) => {
        if (conn.type === 'spotify') {
          const p = config ? await spotify.profile(rt, conn, config) : null;
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
  return c.json(list);
});

api.post('/devices', async (c) => {
  const parsed = z.safeParse(device_input_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const env = parse_env(c.env);
  const device = await with_db(env.DATABASE_URL, (rt) =>
    devices.create(rt, parsed.data),
  );
  if (device.access_token !== null)
    c.executionCtx.waitUntil(busybar.sync_assets(device.access_token));
  return c.json(devices.redact(device), 201);
});

api.post('/devices/:id/refresh', async (c) => {
  const env = parse_env(c.env);
  const device = await with_db(env.DATABASE_URL, (rt) =>
    devices.get(rt, c.req.param('id')),
  );
  if (!device) return c.json({ error: 'device not found' }, 404);
  if (device.access_token === null)
    return c.json({ error: 'device has no busy bar token' }, 422);
  try {
    await busybar.sync_assets(device.access_token);
  } catch (error) {
    return c.json(
      { error: `asset upload to busy bar failed: ${String(error)}` },
      502,
    );
  }
  return c.json({ refreshed: true }, 200);
});

api.post('/devices/:id', async (c) => {
  const parsed = z.safeParse(device_input_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const env = parse_env(c.env);
  const device = await with_db(env.DATABASE_URL, (rt) =>
    devices.update(rt, c.req.param('id'), parsed.data),
  );
  if (!device) return c.json({ error: 'device not found' }, 404);
  if (parsed.data.access_token !== undefined && device.access_token !== null)
    c.executionCtx.waitUntil(busybar.sync_assets(device.access_token));
  return c.json(devices.redact(device));
});

api.get('/devices/:id', async (c) => {
  const env = parse_env(c.env);
  const device = await with_db(env.DATABASE_URL, (rt) =>
    devices.get(rt, c.req.param('id')),
  );
  if (!device) return c.json({ error: 'device not found' }, 404);
  return c.json(devices.redact(device));
});

api.get('/connections/spotify/authorize', async (c) => {
  const config = spotify_config(c.env);
  if (!config) return c.json({ error: 'spotify not configured' }, 500);
  const env = parse_env(c.env);
  const user_id = await with_db(env.DATABASE_URL, (rt) => ensure_default(rt));
  return c.redirect(spotify_api.authorize_url(config, user_id));
});

api.get('/connections/spotify/callback', async (c) => {
  const config = spotify_config(c.env);
  if (!config) return c.json({ error: 'spotify not configured' }, 500);
  const code = c.req.query('code');
  const user_id = c.req.query('state') ?? DEFAULT_USER_ID;
  if (!code) return c.json({ error: 'code required' }, 400);

  const result = await spotify_api.exchange_code(config, code);
  if (result.type === 'error') return c.json({ error: result.message }, 502);
  if (!result.refresh_token)
    return c.json({ error: 'spotify did not return a refresh token' }, 502);
  const refresh_token = result.refresh_token;
  const access_token = result.access_token;
  const expires_at = new Date(Date.now() + result.expires_in * 1000);

  const env = parse_env(c.env);
  const updated = await with_db(env.DATABASE_URL, (rt) =>
    connections.set_spotify_auth(rt, user_id, {
      refresh_token,
      access_token,
      expires_at,
    }),
  );
  if (!updated) return c.json({ error: 'could not link spotify' }, 502);
  return c.redirect('/');
});

api.post('/connections/litterbot', async (c) => {
  const parsed = z.safeParse(litterbot_login_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const result = await litterbot_api.login(
    parsed.data.username,
    parsed.data.password,
  );
  if (result.type === 'error') return c.json({ error: result.message }, 502);
  const env = parse_env(c.env);
  const user_id = await with_db(env.DATABASE_URL, (rt) => ensure_default(rt));
  const updated = await with_db(env.DATABASE_URL, (rt) =>
    connections.set_litterbot_auth(rt, user_id, {
      access_token: result.token.access_token,
      refresh_token: result.token.refresh_token,
      expires_at: new Date(Date.now() + result.token.expires_in * 1000),
    }),
  );
  if (!updated) return c.json({ error: 'could not link litter robot' }, 502);
  return c.json({ linked: true }, 201);
});

api.post('/workflows/litterbot-poll', async (c) => {
  const parsed = z.safeParse(litterbot_poll_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const env = parse_env(c.env);
  const outcome = await with_db(env.DATABASE_URL, (rt) =>
    litterbot.handle_poll(rt, litterbot_deps(env), parsed.data),
  );
  return c.json(outcome, 200);
});

api.post('/ingest/debug', async (c) => {
  const parsed = z.safeParse(debug_ingest_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const event = debug.ingest(parsed.data);
  const env = parse_env(c.env);
  const qstash = make_qstash(env);
  const url = workflow_url(env) ?? `${env.API_HOST}/api/workflows/event`;
  c.executionCtx.waitUntil(workflow.enqueue(qstash, url, event));
  return c.json({ queued: event.device_id }, 202);
});

api.post('/workflows/spotify-poll', async (c) => {
  const parsed = z.safeParse(spotify_poll_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const config = spotify_config(c.env);
  if (!config) return c.json({ error: 'spotify not configured' }, 500);
  const env = parse_env(c.env);
  const outcome = await with_db(env.DATABASE_URL, (rt) =>
    spotify.handle_poll(rt, poll_deps(env, config), parsed.data),
  );
  return c.json(outcome, 200);
});

api.post('/workflows/event', async (c) => {
  const parsed = z.safeParse(busy_event_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const env = parse_env(c.env);
  const result = await with_db(env.DATABASE_URL, (rt) =>
    workflow.handle(rt, parsed.data),
  );
  // Always ack (2xx). This is a FIFO qstash queue: a non-2xx response makes
  // qstash retry and head-of-line-block the queue, backing up every device.
  // None of these outcomes are fixed by retrying the same (now stale) frame;
  // the next poll enqueues a fresh one. Genuine infra faults (e.g. DB access)
  // still throw from `with_db` above and surface as 500 for a legitimate retry.
  if (result.status === 'draw_failed')
    console.warn(`draw failed for ${parsed.data.device_id}: ${result.message}`);
  return c.json(result, 200);
});

/*
 * Scheduled cron job.
 *
 * @see `triggers` in ./wrangler.toml
 *
 **/
async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  const parsed = parse_env(env);
  const config = spotify_config(env);
  const spotify_deps = config ? poll_deps(parsed, config) : null;
  const lb_deps = litterbot_deps(parsed);
  await with_db(parsed.DATABASE_URL, async (rt) => {
    for (const conn of await connections.all(rt)) {
      if (conn.type === 'spotify' && spotify_deps)
        await spotify.ensure_scheduled(rt, spotify_deps, conn);
      else if (conn.type === 'litterbot')
        await litterbot.ensure_scheduled(rt, lb_deps, conn);
    }
  });
}

app.get('/', (c) => c.html(render_page()));
app.route('/api', api);

export default { fetch: app.fetch, scheduled };
