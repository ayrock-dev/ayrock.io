import type { DisplayElements } from '@busy-app/busy-lib';
import type { Client } from '@upstash/qstash';
import type { connection } from '../features/connections';
import * as connections from '../features/connections';
import * as devices from '../features/devices';
import type { config, track } from '../features/spotify';
import * as spotify from '../features/spotify';
import * as workflow from '../features/workflow';
import { to_printable_ascii } from '../lib/ascii';
import {
  BusyEvent,
  type busy_event,
  device_priority,
  type draw_frame,
  type event_props,
} from '../lib/events';
import { nanoid } from '../lib/nanoid';
import type { DbRuntime } from '../lib/prisma';

const G = '#1DB954FF';
const W = '#FFFFFFFF';
const N = null;
const to_color = (ch: string) => (ch === 'G' ? G : ch === 'W' ? W : N);

const logo = [
  '......GGGG......',
  '...GGGGGGGGGG...',
  '..GGGGGGGGGGGG..',
  '.GGGGGGGGGGGGGG.',
  'GGGWWWWWWWWWWGGG',
  'GGWWGGGGGGGGWWGG',
  'GGGGGGGGGGGGGGGG',
  'GGGWWWWWWWWWGGGG',
  'GGWWGGGGGGGWWGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGWWWWWWWGGGGG',
  'GGGWWGGGGWWGGGGG',
  '.GGGGGGGGGGGGGGG',
  '..GGGGGGGGGGGG..',
  '...GGGGGGGGGG...',
  '......GGGG......',
].map((line) => [...line].map(to_color));

function row_run(
  map: (string | null)[][],
  timeout_s: number,
): DisplayElements['elements'] {
  const elements: DisplayElements['elements'] = [];
  let n = 0;
  for (let y = 0; y < map.length; y++) {
    const row = map[y];
    if (!row) continue;
    let x = 0;
    while (x < row.length) {
      const color = row[x];
      if (color === null || color === undefined) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run] === color) run++;
      elements.push({
        id: `logo_${n++}`,
        type: 'rectangle',
        x,
        y,
        display: 'front',
        width: run,
        height: 1,
        fill: 'solid',
        fill_colors: [color],
        border_width: 0,
        border_color: '#00000000',
        timeout: timeout_s,
      });
      x += run;
    }
  }
  return elements;
}

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
        ...row_run(logo, timeout_s),
        {
          id: 'track_name',
          type: 'text',
          text: to_printable_ascii(this.track.name),
          x: text_x,
          y: 1,
          display: 'front',
          font: 'small',
          color: W,
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

async function access_token_for(
  rt: DbRuntime,
  conn: connection,
  config: config,
): Promise<string | null> {
  if (conn.expires_at.getTime() > Date.now() + 10_000) return conn.access_token;
  if (conn.refresh_token === null) return null;

  const result = await spotify.refresh_access_token(config, conn.refresh_token);
  if (result.type === 'error') return null;

  await connections.set_spotify_auth(rt, conn.user_id, {
    access_token: result.access_token,
    expires_at: new Date(Date.now() + result.expires_in * 1000),
    ...(result.refresh_token !== undefined
      ? { refresh_token: result.refresh_token }
      : {}),
  });
  return result.access_token;
}

export async function profile(
  rt: DbRuntime,
  conn: connection,
  config: config,
): Promise<spotify.profile | null> {
  const token = await access_token_for(rt, conn, config);
  if (!token) return null;
  return spotify.get_profile(token);
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
): Promise<void> {
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
  try {
    await deps.qstash.publishJSON({
      url: deps.poll_url,
      body: { connection_id, event_id },
      delay: delay_s,
      deduplicationId: event_id,
      retries: 3,
    });
  } catch (error) {
    await connections.set_poll_state(
      rt,
      connection_id,
      { event_id: null, next_event_at: null },
      { value: null },
    );
    throw error;
  }
}

async function drop(rt: DbRuntime, connection_id: string): Promise<void> {
  await connections.set_poll_state(
    rt,
    connection_id,
    { event_id: null, next_event_at: null },
    { value: null },
  );
}

type playing = Extract<spotify.now_playing_result, { type: 'playing' }>;

async function draw_and_arm(
  rt: DbRuntime,
  deps: poll_deps,
  conn: connection,
  state: playing,
): Promise<void> {
  const remaining_ms = Math.max(state.duration_ms - state.progress_ms, 0);
  const delay_s = delay_for(remaining_ms);

  for (const device of await devices.all(rt, conn.user_id)) {
    if (device.access_token === null) continue;
    await workflow.enqueue(
      deps.qstash,
      deps.workflow_url,
      to_event(device.id, state.track, delay_s),
    );
  }

  await schedule(rt, deps, conn.id, delay_s, state.uri);
}

export type poll_outcome =
  | { status: 'playing' }
  | { status: 'idle' }
  | { status: 'superseded' }
  | { status: 'unknown' }
  | { status: 'no_token' }
  | { status: 'error' };

export async function handle_poll(
  rt: DbRuntime,
  deps: poll_deps,
  payload: { connection_id: string; event_id: string },
): Promise<poll_outcome> {
  const conn = await connections.get_by_id(rt, payload.connection_id);
  if (conn?.type !== 'spotify') return { status: 'unknown' };
  if (conn.event_id !== payload.event_id) return { status: 'superseded' };

  const token = await access_token_for(rt, conn, deps.config);
  if (!token) {
    await drop(rt, conn.id);
    return { status: 'no_token' };
  }

  const state = await spotify.now_playing(token);
  if (state.type === 'error') {
    await schedule(rt, deps, conn.id, error_retry_s, conn.cursor);
    return { status: 'error' };
  }
  if (state.type === 'nothing') {
    await drop(rt, conn.id);
    return { status: 'idle' };
  }

  await draw_and_arm(rt, deps, conn, state);
  return { status: 'playing' };
}

export async function ensure_scheduled(
  rt: DbRuntime,
  deps: poll_deps,
  conn: connection,
): Promise<void> {
  const alive =
    conn.event_id !== null &&
    conn.next_event_at !== null &&
    conn.next_event_at.getTime() > Date.now();

  const token = await access_token_for(rt, conn, deps.config);
  if (!token) return;

  const state = await spotify.now_playing(token);
  if (state.type === 'error') return;

  if (state.type === 'nothing') {
    if (alive) await drop(rt, conn.id);
    return;
  }

  if (alive && state.uri === conn.cursor) return;

  await draw_and_arm(rt, deps, conn, state);
}
