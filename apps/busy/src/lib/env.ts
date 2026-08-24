import * as z from 'zod/mini';

const env_schema = z.object({
  DATABASE_URL: z.string(),
  QSTASH_URL: z.string(),
  QSTASH_TOKEN: z.string(),
  API_HOST: z.optional(z.string()),
});

export type Env = z.infer<typeof env_schema>;

export function parse_env(env: unknown): Env {
  return z.parse(env_schema, env);
}

export function api_origin(api_host: string | undefined): string | undefined {
  if (!api_host) return undefined;
  const base = api_host.includes('://') ? api_host : `https://${api_host}`;
  return new URL(base).origin;
}

export function workflow_url(env: Env): string | undefined {
  const origin = api_origin(env.API_HOST);
  return origin ? `${origin}/api/workflows/event` : undefined;
}

export function spotify_redirect_uri(
  api_host: string | undefined,
): string | undefined {
  const origin = api_origin(api_host);
  return origin ? `${origin}/api/connections/spotify/callback` : undefined;
}
