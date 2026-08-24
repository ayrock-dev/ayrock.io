import { nanoid } from '../lib/nanoid';
import { type DbRuntime, db } from '../lib/prisma';
import { DEFAULT_USER_ID, ensure_default } from './users';

export type device = {
  id: string;
  name: string | null;
  busybar_auth?: string;
  user_id: string;
};

export type device_input = {
  name?: string | null;
  busybar_auth?: string;
};

type device_row = {
  id: string;
  name: string | null;
  accessToken: string | null;
  userId: string;
};

function to_device(row: device_row): device {
  const base: device = {
    id: row.id,
    name: row.name ?? null,
    user_id: row.userId,
  };
  if (row.accessToken !== null) base.busybar_auth = row.accessToken;
  return base;
}

export async function all(
  rt: DbRuntime,
  user_id: string = DEFAULT_USER_ID,
): Promise<device[]> {
  const rows = await rt.query(
    db.sql.public['ayrock.busy.device']
      .select('id', 'name', 'accessToken', 'userId')
      .where((f, fns) => fns.eq(f.userId, user_id))
      .build(),
  );
  return rows.map(to_device);
}

export async function get(rt: DbRuntime, id: string): Promise<device | null> {
  const rows = await rt.query(
    db.sql.public['ayrock.busy.device']
      .select('id', 'name', 'accessToken', 'userId')
      .where((f, fns) => fns.eq(f.id, id))
      .limit(1)
      .build(),
  );
  const row = rows[0];
  return row ? to_device(row) : null;
}

export async function create(
  rt: DbRuntime,
  input: device_input,
  user_id: string = DEFAULT_USER_ID,
): Promise<device> {
  await ensure_default(rt);
  const id = nanoid();
  const name = input.name ?? null;
  await rt.execute(
    db.sql.public['ayrock.busy.device']
      .insert([
        {
          id,
          name,
          userId: user_id,
          accessToken: input.busybar_auth ?? null,
        },
      ])
      .build(),
  );
  return get(rt, id) as Promise<device>;
}

export async function update(
  rt: DbRuntime,
  id: string,
  patch: device_input,
): Promise<device | null> {
  const existing = await get(rt, id);
  if (!existing) return null;
  const fields: { name?: string | null; accessToken?: string | null } = {};
  if (patch.name !== undefined) fields.name = patch.name ?? null;
  if (patch.busybar_auth !== undefined) fields.accessToken = patch.busybar_auth;
  if (Object.keys(fields).length > 0)
    await rt.execute(
      db.sql.public['ayrock.busy.device']
        .update(fields)
        .where((f, fns) => fns.eq(f.id, id))
        .build(),
    );
  return get(rt, id);
}

export function redact(device: device): device {
  const redacted: device = {
    id: device.id,
    name: device.name,
    user_id: device.user_id,
  };
  if (device.busybar_auth !== undefined) redacted.busybar_auth = '***';
  return redacted;
}
