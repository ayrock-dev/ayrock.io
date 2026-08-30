import postgres_serverless from '@prisma/orm-postgres/serverless';
import type { Contract } from './schema.d.ts';
import contract_json from './schema.json' with { type: 'json' };

export const db = postgres_serverless<Contract>({
  contractJson: contract_json,
});

export type DbRuntime = Awaited<ReturnType<typeof db.connect>>;

export async function with_db<T>(
  url: string,
  fn: (rt: DbRuntime) => Promise<T>,
): Promise<T> {
  const rt = await db.connect({ url });
  try {
    return await fn(rt);
  } finally {
    await rt.close();
  }
}
