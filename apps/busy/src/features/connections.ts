import { nanoid } from '../lib/nanoid';
import { type DbRuntime, db } from '../lib/prisma';
import { DEFAULT_USER_ID, ensure_default } from './users';

export type spotify_auth = {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
};

export type connection = {
  id: string;
  type: string;
  user_id: string;
  spotify_auth?: spotify_auth;
};

type connection_row = {
  id: string;
  type: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
};

function to_connection(row: connection_row): connection {
  const base: connection = { id: row.id, type: row.type, user_id: row.userId };
  if (row.type === 'spotify' && row.refreshToken !== null)
    base.spotify_auth = {
      refresh_token: row.refreshToken,
      access_token: row.accessToken ?? undefined,
      expires_at: row.expiresAt !== null ? row.expiresAt.getTime() : undefined,
    };
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
        'userId',
        'accessToken',
        'refreshToken',
        'expiresAt',
      )
      .where((f, fns) => fns.eq(f.userId, user_id))
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
    refreshToken: merged.refresh_token,
    accessToken: merged.access_token ?? null,
    expiresAt: merged.expires_at ? new Date(merged.expires_at) : null,
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
        .insert([{ id: nanoid(), userId: user_id, type: 'spotify', ...fields }])
        .build(),
    );
  return get_spotify(rt, user_id);
}

export function redact(conn: connection): connection {
  if (conn.spotify_auth)
    return { ...conn, spotify_auth: { refresh_token: '***' } };
  return conn;
}
