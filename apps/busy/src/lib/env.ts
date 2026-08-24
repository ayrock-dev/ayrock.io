import * as z from 'zod/mini';

const env_schema = z.object({
  API_HOST: z.string(),
  DATABASE_URL: z.string(),
  QSTASH_URL: z.string(),
  QSTASH_TOKEN: z.string(),
  SPOTIFY_CLIENT_ID: z.string(),
  SPOTIFY_CLIENT_SECRET: z.string(),
});

export type Env = z.infer<typeof env_schema>;

export function parse_env(env: unknown): Env {
  return z.parse(env_schema, env);
}

export function workflow_url(env: Env): string {
  return `${env.API_HOST}/api/workflows/event`;
}

export function spotify_redirect_uri(env: Env): string {
  return `${env.API_HOST}/api/connections/spotify/callback`;
}
