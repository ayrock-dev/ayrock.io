import { nanoid } from '../lib/nanoid';
import { type DbRuntime, db } from '../lib/prisma';
import type { FieldOutputTypes } from '../lib/schema.d.ts';
import { DEFAULT_USER_ID, ensure_default } from './users';

export type connection = Omit<
  FieldOutputTypes['public']['Connection'],
  'created_at' | 'updated_at'
>;

export type spotify_auth = {
  access_token: string;
  expires_at: Date;
  refresh_token?: string;
};

export type litterbot_auth = {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
};

export type poll_state = {
  event_id: string | null;
  next_event_at: Date | null;
};

const columns = [
  'id',
  'type',
  'user_id',
  'access_token',
  'refresh_token',
  'expires_at',
  'event_id',
  'next_event_at',
  'cursor',
] as const;

async function read_all(rt: DbRuntime, user_id: string): Promise<connection[]> {
  return rt.query(
    db.sql.public['ayrock.busy.connection']
      .select(...columns)
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
      .select(...columns)
      .where((f, fns) => fns.eq(f.id, id))
      .limit(1)
      .build(),
  );
  return rows[0] ?? null;
}

export async function set_poll_state(
  rt: DbRuntime,
  id: string,
  state: poll_state,
  cursor?: { value: string | null },
): Promise<void> {
  const fields =
    cursor === undefined
      ? { event_id: state.event_id, next_event_at: state.next_event_at }
      : {
          event_id: state.event_id,
          next_event_at: state.next_event_at,
          cursor: cursor.value,
        };
  await rt.execute(
    db.sql.public['ayrock.busy.connection']
      .update(fields)
      .where((f, fns) => fns.eq(f.id, id))
      .build(),
  );
}

export async function set_cursor(
  rt: DbRuntime,
  id: string,
  cursor: string | null,
): Promise<void> {
  await rt.execute(
    db.sql.public['ayrock.busy.connection']
      .update({ cursor })
      .where((f, fns) => fns.eq(f.id, id))
      .build(),
  );
}

export async function all(
  rt: DbRuntime,
  user_id: string = DEFAULT_USER_ID,
): Promise<connection[]> {
  return read_all(rt, user_id);
}

export async function get_spotify(
  rt: DbRuntime,
  user_id: string = DEFAULT_USER_ID,
): Promise<connection | null> {
  return (
    (await read_all(rt, user_id)).find((r) => r.type === 'spotify') ?? null
  );
}

export async function get_litterbot(
  rt: DbRuntime,
  user_id: string = DEFAULT_USER_ID,
): Promise<connection | null> {
  return (
    (await read_all(rt, user_id)).find((r) => r.type === 'litterbot') ?? null
  );
}

export async function set_litterbot_auth(
  rt: DbRuntime,
  user_id: string,
  patch: litterbot_auth,
): Promise<connection | null> {
  await ensure_default(rt);
  const existing = await get_litterbot(rt, user_id);
  const fields = {
    access_token: patch.access_token,
    refresh_token: patch.refresh_token,
    expires_at: patch.expires_at,
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
        .insert([{ id: nanoid(), user_id, type: 'litterbot', ...fields }])
        .build(),
    );
  return get_litterbot(rt, user_id);
}

export async function set_spotify_auth(
  rt: DbRuntime,
  user_id: string,
  patch: spotify_auth,
): Promise<connection | null> {
  await ensure_default(rt);
  const existing = await get_spotify(rt, user_id);
  const refresh_token = patch.refresh_token ?? existing?.refresh_token;
  if (!refresh_token) return null;
  const fields = {
    access_token: patch.access_token,
    refresh_token,
    expires_at: patch.expires_at,
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
  return {
    ...conn,
    access_token: '***',
    refresh_token: conn.refresh_token === null ? null : '***',
  };
}
