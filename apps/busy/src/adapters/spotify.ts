import type { DisplayElements } from '@busy-app/busy-lib';
import type { connection } from '../features/connections';
import * as connections from '../features/connections';
import type { config, track } from '../features/spotify';
import * as spotify from '../features/spotify';
import {
  BusyEvent,
  type busy_event,
  device_priority,
  type draw_frame,
  type event_props,
} from '../lib/events';
import type { DbRuntime } from '../lib/prisma';

const G = '#1DB954FF';
const W = '#FFFFFFFF';
const N = null;
const to_color = (ch: string) => (ch === 'G' ? G : ch === 'W' ? W : N);

const logo = [
  '....GGGGGGGG....',
  '..GGGGGGGGGGGG..',
  '.GGGGGGGGGGGGGG.',
  'GGGGGGGGGGGGGGGG',
  'GGGWWWWWWWWWWGGG',
  'GGWWGGGGGGGGWWGG',
  'GGGGGGGGGGGGGGGG',
  'GGGWWWWWWWWWGGGG',
  'GGWWGGGGGGGWWGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGWWWWWWWGGGGG',
  'GGGWWGGGGWWGGGGG',
  'GGGGGGGGGGGGGGGG',
  '.GGGGGGGGGGGGGG.',
  '..GGGGGGGGGGGG..',
  '....GGGGGGGG....',
].map((line) => [...line].map(to_color));

const timeout_s = 55;

function row_run(map: (string | null)[][]): DisplayElements['elements'] {
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

function track_key(t: track): string {
  return `${t.name}\u0000${t.artists.join(',')}`;
}

export class SpotifyEvent extends BusyEvent {
  private readonly track: track;

  constructor(props: event_props & { track: track }) {
    super(props);
    this.track = props.track;
  }

  render(): draw_frame {
    const text_x = 18;
    const text_width = 72 - text_x;
    return {
      priority: this.priority,
      elements: [
        ...row_run(logo),
        {
          id: 'track_name',
          type: 'text',
          text: this.track.name,
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
          text: this.track.artists.join(', '),
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

const last_seen = new Map<string, string>();

async function access_token_for(
  rt: DbRuntime,
  conn: connection,
  config: config,
): Promise<string | null> {
  const auth = conn.spotify_auth;
  if (!auth) return null;

  const valid =
    auth.access_token !== undefined &&
    auth.expires_at !== undefined &&
    auth.expires_at > Date.now() + 10_000;
  if (valid && auth.access_token !== undefined) return auth.access_token;

  const result = await spotify.refresh_access_token(config, auth.refresh_token);
  if (result.type === 'error') return null;

  await connections.set_spotify_auth(rt, conn.user_id, {
    access_token: result.access_token,
    expires_at: Date.now() + result.expires_in * 1000,
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

export function to_event(device_id: string, track: track): busy_event {
  return {
    type: 'spotify',
    device_id,
    priority: device_priority.neutral,
    track,
  };
}

export async function poll(
  rt: DbRuntime,
  conn: connection,
  config: config,
): Promise<track | null> {
  if (!conn.spotify_auth) return null;

  const token = await access_token_for(rt, conn, config);
  if (!token) return null;

  const state = await spotify.now_playing(token);
  if (state.type !== 'playing') {
    if (state.type === 'nothing') last_seen.delete(conn.id);
    return null;
  }

  const key = track_key(state.track);
  if (last_seen.get(conn.id) === key) return null;
  last_seen.set(conn.id, key);

  return state.track;
}
