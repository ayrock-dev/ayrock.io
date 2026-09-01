import type { Client } from '@upstash/qstash';
import { Result } from 'better-result';
import type { connection } from '../features/connections';
import * as connections from '../features/connections';
import * as devices from '../features/devices';
import type { config, track } from '../features/spotify';
import * as spotify from '../features/spotify';
import * as workflow from '../features/workflow';
import { to_printable_ascii } from '../lib/ascii';
import type { QueuePublishFailed, spotify_error } from '../lib/errors';
import {
  BusyEvent,
  type busy_event,
  device_priority,
  type draw_frame,
  type event_props,
} from '../lib/events';
import { spotify_path } from '../lib/icons';
import { nanoid } from '../lib/nanoid';
import type { DbRuntime } from '../lib/prisma';

export class SpotifyEvent extends BusyEvent {
  private readonly track: track;
  private readonly timeout_s: number;

  constructor(props: event_props & { track: track; timeout: number }) {
    super(props);
    this.track = props.track;
    this.timeout_s = props.timeout;
  }

  render(): draw_frame {
    const text_x = 18;
    const text_width = 72 - text_x;
    const timeout_s = this.timeout_s;
    return {
      priority: this.priority,
      elements: [
        {
          id: 'logo',
          type: 'image',
          path: spotify_path,
          x: 0,
          y: 0,
          display: 'front',
          opacity: 100,
          timeout: timeout_s,
        },
        {
          id: 'track_name',
          type: 'text',
          text: to_printable_ascii(this.track.name),
          x: text_x,
          y: 1,
          display: 'front',
          font: 'small',
          color: '#FFFFFFFF',
          width: text_width,
          scroll_rate: 600,
          timeout: timeout_s,
        },
        {
          id: 'track_artist',
          type: 'text',
          text: to_printable_ascii(this.track.artists.join(', ')),
          x: text_x,
          y: 9,
          display: 'front',
          font: 'small',
          color: '#B3B3B3FF',
          width: text_width,
          scroll_rate: 600,
          timeout: timeout_s,
        },
      ],
    };
  }
}

const buffer_s = 2;
const min_delay_s = 5;
const error_retry_s = 15;
const grace_ms = 30_000;

/*
 * Resolve a usable access token. `Result.ok(token)` when live or refreshed, `Result.ok(null)`
 * when the token is expired and no refresh token exists (a legal not-linked
 * state), and `err` only for a genuine upstream spotify fault during refresh —
 * which the caller reschedules rather than treating as terminal.
 */
async function access_token_for(
  rt: DbRuntime,
  conn: connection,
  config: config,
): Promise<Result<string | null, spotify_error>> {
  if (conn.expires_at.getTime() > Date.now() + 10_000)
    return Result.ok(conn.access_token);
  if (conn.refresh_token === null) return Result.ok(null);

  const result = await spotify.refresh_access_token(config, conn.refresh_token);
  if (result.isErr()) return result;

  await connections.set_spotify_auth(rt, conn.user_id, {
    access_token: result.value.access_token,
    expires_at: new Date(Date.now() + result.value.expires_in * 1000),
    ...(result.value.refresh_token !== undefined
      ? { refresh_token: result.value.refresh_token }
      : {}),
  });
  return Result.ok(result.value.access_token);
}

export async function profile(
  rt: DbRuntime,
  conn: connection,
  config: config,
): Promise<Result<spotify.profile | null, spotify_error>> {
  const token = await access_token_for(rt, conn, config);
  if (token.isErr()) return token;
  if (!token.value) return Result.ok(null);
  return spotify.get_profile(token.value);
}

export function to_event(
  device_id: string,
  track: track,
  timeout: number,
): busy_event {
  return {
    type: 'spotify',
    device_id,
    priority: device_priority.neutral,
    timeout,
    track,
  };
}

export type poll_deps = {
  qstash: Client;
  poll_url: string;
  workflow_url: string;
  config: config;
};

function delay_for(remaining_ms: number): number {
  return Math.max(Math.ceil(remaining_ms / 1000) + buffer_s, min_delay_s);
}

async function schedule(
  rt: DbRuntime,
  deps: poll_deps,
  connection_id: string,
  delay_s: number,
  armed_uri: string | null,
): Promise<Result<void, QueuePublishFailed>> {
  const event_id = nanoid();
  await connections.set_poll_state(
    rt,
    connection_id,
    {
      event_id,
      next_event_at: new Date(Date.now() + delay_s * 1000 + grace_ms),
    },
    { value: armed_uri },
  );
  const published = await workflow.publish_poll(deps.qstash, deps.poll_url, {
    connection_id,
    event_id,
    delay_s,
  });
  if (published.isErr()) {
    // Roll the armed state back so the next cron tick re-arms from scratch
    // rather than believing a poll is already in flight.
    await connections.set_poll_state(
      rt,
      connection_id,
      { event_id: null, next_event_at: null },
      { value: null },
    );
    return published;
  }
  return Result.ok(undefined);
}

async function drop(rt: DbRuntime, connection_id: string): Promise<void> {
  await connections.set_poll_state(
    rt,
    connection_id,
    { event_id: null, next_event_at: null },
    { value: null },
  );
}

type playing = Extract<spotify.now_playing, { type: 'playing' }>;

async function draw_and_arm(
  rt: DbRuntime,
  deps: poll_deps,
  conn: connection,
  state: playing,
): Promise<Result<void, QueuePublishFailed>> {
  const remaining_ms = Math.max(state.duration_ms - state.progress_ms, 0);
  const delay_s = delay_for(remaining_ms);

  for (const device of await devices.all(rt, conn.user_id)) {
    if (device.access_token === null) continue;
    const enqueued = await workflow.enqueue(
      deps.qstash,
      deps.workflow_url,
      to_event(device.id, state.track, delay_s),
    );
    if (enqueued.isErr()) return enqueued;
  }

  return schedule(rt, deps, conn.id, delay_s, state.uri);
}

export type poll_outcome =
  | { status: 'playing' }
  | { status: 'idle' }
  | { status: 'superseded' }
  | { status: 'unknown' }
  | { status: 'no_token' }
  | { status: 'error'; reason: string };

/*
 * Drive one poll cycle. Expected states (superseded, idle, not-linked, a
 * transient spotify fault) are returned as `poll_outcome` values so the queue
 * consumer acks them. Only a queue publish failure escapes as `Err`, letting the
 * endpoint surface a 500 for a legitimate qstash retry.
 */
export async function handle_poll(
  rt: DbRuntime,
  deps: poll_deps,
  payload: { connection_id: string; event_id: string },
): Promise<Result<poll_outcome, QueuePublishFailed>> {
  const conn = await connections.get_by_id(rt, payload.connection_id);
  if (conn?.type !== 'spotify') return Result.ok({ status: 'unknown' });
  if (conn.event_id !== payload.event_id)
    return Result.ok({ status: 'superseded' });

  // On a transient upstream fault, re-arm a short retry instead of dropping the
  // schedule; only a queue publish failure escapes.
  const retry = async (
    reason: string,
  ): Promise<Result<poll_outcome, QueuePublishFailed>> => {
    const rescheduled = await schedule(
      rt,
      deps,
      conn.id,
      error_retry_s,
      conn.cursor,
    );
    if (rescheduled.isErr()) return rescheduled;
    return Result.ok({ status: 'error', reason });
  };

  const token = await access_token_for(rt, conn, deps.config);
  if (token.isErr()) return retry(token.error.message);
  if (!token.value) {
    await drop(rt, conn.id);
    return Result.ok({ status: 'no_token' });
  }

  const state = await spotify.now_playing(token.value);
  if (state.isErr()) return retry(state.error.message);
  if (state.value.type === 'nothing') {
    await drop(rt, conn.id);
    return Result.ok({ status: 'idle' });
  }

  const armed = await draw_and_arm(rt, deps, conn, state.value);
  if (armed.isErr()) return armed;
  return Result.ok({ status: 'playing' });
}

export async function ensure_scheduled(
  rt: DbRuntime,
  deps: poll_deps,
  conn: connection,
): Promise<Result<void, QueuePublishFailed>> {
  const alive =
    conn.event_id !== null &&
    conn.next_event_at !== null &&
    conn.next_event_at.getTime() > Date.now();

  const token = await access_token_for(rt, conn, deps.config);
  if (token.isErr() || !token.value) return Result.ok(undefined);

  const state = await spotify.now_playing(token.value);
  if (state.isErr()) return Result.ok(undefined);

  if (state.value.type === 'nothing') {
    if (alive) await drop(rt, conn.id);
    return Result.ok(undefined);
  }

  if (alive && state.value.uri === conn.cursor) return Result.ok(undefined);

  return draw_and_arm(rt, deps, conn, state.value);
}
