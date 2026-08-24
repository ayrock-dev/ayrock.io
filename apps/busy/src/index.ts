import type { DisplayElements } from '@busy-app/busy-lib';
import { Hono } from 'hono';
import * as z from 'zod/mini';
import * as debug from './adapters/debug';
import * as spotify from './adapters/spotify';
import * as connections from './features/connections';
import * as devices from './features/devices';
import * as spotify_api from './features/spotify';
import { DEFAULT_USER_ID, ensure_default } from './features/users';
import * as workflow from './features/workflow';
import {
  type Env,
  parse_env,
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
  busybar_auth: z.optional(z.string()),
});

const draw_element_schema = z.custom<DisplayElements['elements'][number]>(
  (v) => typeof v === 'object' && v !== null && 'id' in v && 'type' in v,
);

const debug_ingest_schema = z.object({
  device_id: z.string(),
  priority: z.optional(z.number()),
  elements: z.array(draw_element_schema),
});

api.get('/healthcheck', (c) => c.text('OK', 200));

api.get('/devices', async (c) => {
  const env = parse_env(c.env);
  const list = await with_db(env.DATABASE_URL, (rt) => devices.all(rt));
  return c.json(
    list.map((d) => ({
      id: d.id,
      name: d.name,
      busybar: d.busybar_auth !== undefined,
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
  return c.json(devices.redact(device), 201);
});

api.post('/devices/:id', async (c) => {
  const parsed = z.safeParse(device_input_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const env = parse_env(c.env);
  const device = await with_db(env.DATABASE_URL, (rt) =>
    devices.update(rt, c.req.param('id'), parsed.data),
  );
  if (!device) return c.json({ error: 'device not found' }, 404);
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
  const expires_at = Date.now() + result.expires_in * 1000;

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

api.post('/workflows/event', async (c) => {
  const parsed = z.safeParse(busy_event_schema, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const env = parse_env(c.env);
  const result = await with_db(env.DATABASE_URL, (rt) =>
    workflow.handle(rt, parsed.data),
  );
  if (result.status === 'conflict')
    return c.json({ error: 'display busy' }, 409);
  if (result.status === 'no_token')
    return c.json({ error: 'no busybar token' }, 422);
  return c.json({ drawn: true }, 200);
});

/*
 * Scheduled cron job.
 *
 * @see `triggers` in ./wrangler.toml
 *
 **/
async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  const config = spotify_config(env);
  if (!config) return;
  const parsed = parse_env(env);
  const url = workflow_url(parsed);
  if (!url) return;
  const qstash = make_qstash(parsed);
  await with_db(parsed.DATABASE_URL, async (rt) => {
    for (const conn of await connections.all(rt)) {
      if (conn.type !== 'spotify' || !conn.spotify_auth) continue;
      const track = await spotify.poll(rt, conn, config);
      if (!track) continue;
      const targets = await devices.all(rt, conn.user_id);
      for (const device of targets) {
        if (device.busybar_auth === undefined) continue;
        await workflow.enqueue(qstash, url, spotify.to_event(device.id, track));
      }
    }
  });
}

app.get('/', (c) => c.html(render_page()));
app.route('/api', api);

export default { fetch: app.fetch, scheduled };
