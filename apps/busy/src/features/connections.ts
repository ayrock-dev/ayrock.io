import { nanoid } from '../lib/nanoid';
import { type DbRuntime, db } from '../lib/prisma';
import { DEFAULT_USER_ID, ensure_default } from './users';

export type spotify_auth = {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
};

export type poll_state = {
  event_id: string | null;
  next_event_at: number | null;
};

export type connection = {
  id: string;
  type: string;
  user_id: string;
  spotify_auth?: spotify_auth;
  event_id?: string;
  next_event_at?: number;
};

type connection_row = {
  id: string;
  type: string;
  user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | null;
  event_id: string | null;
  next_event_at: Date | null;
};

function to_connection(row: connection_row): connection {
  const base: connection = { id: row.id, type: row.type, user_id: row.user_id };
  if (row.type === 'spotify' && row.refresh_token !== null)
    base.spotify_auth = {
      refresh_token: row.refresh_token,
      access_token: row.access_token ?? undefined,
      expires_at:
        row.expires_at !== null ? row.expires_at.getTime() : undefined,
    };
  if (row.event_id !== null) base.event_id = row.event_id;
  if (row.next_event_at !== null)
    base.next_event_at = row.next_event_at.getTime();
  return base;
}

async function read_all(
  rt: DbRuntime,
  user_id: string,
): Promise<connection_row[]> {
  return rt.query(
    db.sql.public['ayrock.busy.connection']
      .select(
        'id',
        'type',
        'user_id',
        'access_token',
        'refresh_token',
        'expires_at',
        'event_id',
        'next_event_at',
      )
      .where((f, fns) => fns.eq(f.user_id, user_id))
      .build(),
  );
}

export async function get_by_id(
  rt: DbRuntime,
  id: string,
): Promise<connection | null> {
  const rows = await rt.query(
    db.sql.public['ayrock.busy.connection']
      .select(
        'id',
        'type',
        'user_id',
        'access_token',
        'refresh_token',
        'expires_at',
        'event_id',
        'next_event_at',
      )
      .where((f, fns) => fns.eq(f.id, id))
      .limit(1)
      .build(),
  );
  const row = rows[0];
  return row ? to_connection(row) : null;
}

export async function set_poll_state(
  rt: DbRuntime,
  id: string,
  state: poll_state,
): Promise<void> {
  await rt.execute(
    db.sql.public['ayrock.busy.connection']
      .update({
        event_id: state.event_id,
        next_event_at:
          state.next_event_at !== null ? new Date(state.next_event_at) : null,
      })
      .where((f, fns) => fns.eq(f.id, id))
      .build(),
  );
}

export async function all(
  rt: DbRuntime,
  user_id: string = DEFAULT_USER_ID,
): Promise<connection[]> {
  return (await read_all(rt, user_id)).map(to_connection);
}

export async function get_spotify(
  rt: DbRuntime,
  user_id: string = DEFAULT_USER_ID,
): Promise<connection | null> {
  const row = (await read_all(rt, user_id)).find((r) => r.type === 'spotify');
  return row ? to_connection(row) : null;
}

export async function set_spotify_auth(
  rt: DbRuntime,
  user_id: string,
  patch: Partial<spotify_auth>,
): Promise<connection | null> {
  await ensure_default(rt);
  const existing = await get_spotify(rt, user_id);
  const refresh_token =
    patch.refresh_token ?? existing?.spotify_auth?.refresh_token;
  if (!refresh_token) return null;
  const merged: spotify_auth = {
    ...existing?.spotify_auth,
    ...patch,
    refresh_token,
  };
  const fields = {
    refresh_token: merged.refresh_token,
    access_token: merged.access_token ?? null,
    expires_at: merged.expires_at ? new Date(merged.expires_at) : null,
  };
  if (existing)
    await rt.execute(
      db.sql.public['ayrock.busy.connection']
        .update(fields)
        .where((f, fns) => fns.eq(f.id, existing.id))
        .build(),
    );
  else
    await rt.execute(
      db.sql.public['ayrock.busy.connection']
        .insert([{ id: nanoid(), user_id, type: 'spotify', ...fields }])
        .build(),
    );
  return get_spotify(rt, user_id);
}

export function redact(conn: connection): connection {
  if (conn.spotify_auth)
    return { ...conn, spotify_auth: { refresh_token: '***' } };
  return conn;
}
