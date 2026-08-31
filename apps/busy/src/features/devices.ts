import { nanoid } from '../lib/nanoid';
import { type DbRuntime, db } from '../lib/prisma';
import type { FieldOutputTypes } from '../lib/schema.d.ts';
import { DEFAULT_USER_ID, ensure_default } from './users';

export type device = Omit<
  FieldOutputTypes['public']['Device'],
  'created_at' | 'updated_at'
>;

export type device_input = {
  name?: string | null;
  access_token?: string;
};

const columns = [
  'id',
  'name',
  'access_token',
  'expires_at',
  'user_id',
] as const;

export async function all(
  rt: DbRuntime,
  user_id: string = DEFAULT_USER_ID,
): Promise<device[]> {
  return rt.query(
    db.sql.public['ayrock.busy.device']
      .select(...columns)
      .where((f, fns) => fns.eq(f.user_id, user_id))
      .build(),
  );
}

export async function get(rt: DbRuntime, id: string): Promise<device | null> {
  const rows = await rt.query(
    db.sql.public['ayrock.busy.device']
      .select(...columns)
      .where((f, fns) => fns.eq(f.id, id))
      .limit(1)
      .build(),
  );
  return rows[0] ?? null;
}

export async function create(
  rt: DbRuntime,
  input: device_input,
  user_id: string = DEFAULT_USER_ID,
): Promise<device> {
  await ensure_default(rt);
  const id = nanoid();
  await rt.execute(
    db.sql.public['ayrock.busy.device']
      .insert([
        {
          id,
          name: input.name ?? null,
          user_id,
          access_token: input.access_token ?? null,
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
  const fields: { name?: string | null; access_token?: string | null } = {};
  if (patch.name !== undefined) fields.name = patch.name ?? null;
  if (patch.access_token !== undefined)
    fields.access_token = patch.access_token;
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
  if (device.access_token === null) return device;
  return { ...device, access_token: '***' };
}
