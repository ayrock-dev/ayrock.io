import { Result } from 'better-result';
import * as z from 'zod/mini';
import { EnvInvalid } from './errors';

const env_schema = z.object({
  API_HOST: z.string(),
  DATABASE_URL: z.string(),
  QSTASH_URL: z.string(),
  QSTASH_TOKEN: z.string(),
  SPOTIFY_CLIENT_ID: z.string(),
  SPOTIFY_CLIENT_SECRET: z.string(),
});

export type Env = z.infer<typeof env_schema>;

export function parse_env(env: unknown): Result<Env, EnvInvalid> {
  const parsed = z.safeParse(env_schema, env);
  if (!parsed.success)
    return Result.err(
      new EnvInvalid({
        message: `worker env failed validation; deploy secrets/vars are missing or malformed: ${parsed.error.message}`,
        cause: parsed.error,
      }),
    );
  return Result.ok(parsed.data);
}

export function workflow_url(env: Env): string {
  return `${env.API_HOST}/api/workflows/event`;
}

export function spotify_poll_url(env: Env): string {
  return `${env.API_HOST}/api/workflows/spotify-poll`;
}

export function litterbot_poll_url(env: Env): string {
  return `${env.API_HOST}/api/workflows/litterbot-poll`;
}

export function spotify_redirect_uri(env: Env): string {
  return `${env.API_HOST}/api/connections/spotify/callback`;
}
