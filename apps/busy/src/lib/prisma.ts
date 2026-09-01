import postgres_serverless from '@prisma/orm-postgres/serverless';
import { Result } from 'better-result';
import { DbUnavailable, error_message } from './errors';
import type { Contract } from './schema.d.ts';
import contract_json from './schema.json' with { type: 'json' };

export const db = postgres_serverless<Contract>({
  contractJson: contract_json,
});

export type DbRuntime = Awaited<ReturnType<typeof db.connect>>;

/*
 * Runs `fn` against a fresh connection and always closes it. Anything thrown
 * while the connection is open — connect, query, or close — surfaces as a single
 * `DbUnavailable` for the caller to map (500) or retry, rather than an
 * unstructured throw. Adapters return their faults as values, so in practice the
 * throwing surface here is the database itself.
 */
export function with_db<T>(
  url: string,
  fn: (rt: DbRuntime) => Promise<T>,
): Promise<Result<T, DbUnavailable>> {
  return Result.tryPromise({
    try: async () => {
      const rt = await db.connect({ url });
      try {
        return await fn(rt);
      } finally {
        await rt.close();
      }
    },
    catch: (cause) =>
      new DbUnavailable({
        message: `database access failed while serving the request: ${error_message(cause)}`,
        cause,
      }),
  });
}
