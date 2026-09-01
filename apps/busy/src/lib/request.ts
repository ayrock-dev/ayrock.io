import { Result } from 'better-result';
import type { Context } from 'hono';
import * as z from 'zod/mini';
import { BodyInvalid, BodyNotJson, error_message } from './errors';

/*
 * Parse and validate a JSON request body at the boundary. The two ways a body
 * can be illegal — unparseable bytes and a well-formed-but-wrong shape — are
 * split into distinct tagged errors so the caller never conflates a malformed
 * client request with a schema mismatch.
 */
export async function read_json_body<T extends z.core.$ZodType>(
  c: Context,
  schema: T,
): Promise<Result<z.core.output<T>, BodyNotJson | BodyInvalid>> {
  const body = await Result.tryPromise({
    try: () => c.req.json(),
    catch: (cause) =>
      new BodyNotJson({
        message: `request body was not valid JSON: ${error_message(cause)}`,
        cause,
      }),
  });
  if (body.isErr()) return body;

  const parsed = z.safeParse(schema, body.value);
  if (!parsed.success)
    return Result.err(
      new BodyInvalid({
        message: `request body did not match the expected shape: ${parsed.error.message}`,
        issues: parsed.error,
      }),
    );
  return Result.ok(parsed.data);
}
