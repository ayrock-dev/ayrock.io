import { type DbRuntime, db } from '../lib/prisma';

export const DEFAULT_USER_ID = 'jwrcxkb0v5';

export async function ensure_default(rt: DbRuntime): Promise<string> {
  const rows = await rt.query(
    db.sql.public['ayrock.busy.user']
      .select('id')
      .where((f, fns) => fns.eq(f.id, DEFAULT_USER_ID))
      .limit(1)
      .build(),
  );
  if (!rows[0])
    await rt.execute(
      db.sql.public['ayrock.busy.user']
        .insert([{ id: DEFAULT_USER_ID }])
        .build(),
    );
  return DEFAULT_USER_ID;
}
