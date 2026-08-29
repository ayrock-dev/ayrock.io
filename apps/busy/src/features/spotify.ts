import * as z from 'zod/mini';

const accounts_base = 'https://accounts.spotify.com';
const api_base = 'https://api.spotify.com/v1';
const scopes = 'user-read-currently-playing user-read-playback-state';

export type config = {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
};

export type track = {
  name: string;
  artists: string[];
  album: string;
};

export type token_result =
  | {
      type: 'ok';
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    }
  | { type: 'error'; message: string };

export type profile = {
  id: string;
  display_name: string | null;
  image_url: string | null;
};

export type now_playing_result =
  | { type: 'playing'; track: track; progress_ms: number; duration_ms: number }
  | { type: 'nothing' }
  | { type: 'error'; message: string };

const token_schema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.optional(z.string()),
});

const profile_schema = z.object({
  id: z.string(),
  display_name: z.nullable(z.string()),
  images: z.array(z.object({ url: z.string() })),
});

const now_playing_schema = z.object({
  is_playing: z.boolean(),
  progress_ms: z.nullable(z.number()),
  item: z.nullable(
    z.object({
      name: z.string(),
      duration_ms: z.number(),
      album: z.object({ name: z.string() }),
      artists: z.array(z.object({ name: z.string() })),
    }),
  ),
});

function basic_auth(config: config): string {
  return `Basic ${btoa(`${config.client_id}:${config.client_secret}`)}`;
}

export function authorize_url(config: config, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.client_id,
    scope: scopes,
    redirect_uri: config.redirect_uri,
    state,
  });
  return `${accounts_base}/authorize?${params.toString()}`;
}

async function post_token(
  config: config,
  body: Record<string, string>,
): Promise<token_result> {
  let response: Response;
  try {
    response = await fetch(`${accounts_base}/api/token`, {
      method: 'POST',
      headers: {
        authorization: basic_auth(config),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    });
  } catch (error) {
    return {
      type: 'error',
      message: `spotify token request failed: ${String(error)}`,
    };
  }

  if (!response.ok) {
    return {
      type: 'error',
      message: `spotify token endpoint returned ${response.status}: ${await response.text()}`,
    };
  }

  const parsed = z.safeParse(token_schema, await response.json());
  if (!parsed.success) {
    return {
      type: 'error',
      message: `unexpected spotify token response: ${parsed.error.message}`,
    };
  }
  return {
    type: 'ok',
    access_token: parsed.data.access_token,
    expires_in: parsed.data.expires_in,
    refresh_token: parsed.data.refresh_token,
  };
}

export function exchange_code(
  config: config,
  code: string,
): Promise<token_result> {
  return post_token(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirect_uri,
  });
}

export function refresh_access_token(
  config: config,
  refresh_token: string,
): Promise<token_result> {
  return post_token(config, {
    grant_type: 'refresh_token',
    refresh_token,
  });
}

export async function get_profile(
  access_token: string,
): Promise<profile | null> {
  let response: Response;
  try {
    response = await fetch(`${api_base}/me`, {
      headers: { authorization: `Bearer ${access_token}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const parsed = z.safeParse(profile_schema, await response.json());
  if (!parsed.success) return null;
  return {
    id: parsed.data.id,
    display_name: parsed.data.display_name,
    image_url: parsed.data.images[0]?.url ?? null,
  };
}

export async function now_playing(
  access_token: string,
): Promise<now_playing_result> {
  let response: Response;
  try {
    response = await fetch(`${api_base}/me/player/currently-playing`, {
      headers: { authorization: `Bearer ${access_token}` },
    });
  } catch (error) {
    return {
      type: 'error',
      message: `spotify now-playing request failed: ${String(error)}`,
    };
  }

  if (response.status === 204) return { type: 'nothing' };

  if (!response.ok) {
    return {
      type: 'error',
      message: `spotify now-playing returned ${response.status}: ${await response.text()}`,
    };
  }

  const parsed = z.safeParse(now_playing_schema, await response.json());
  if (!parsed.success) {
    return {
      type: 'error',
      message: `unexpected now-playing response: ${parsed.error.message}`,
    };
  }

  const { is_playing, item, progress_ms } = parsed.data;
  if (!is_playing || !item) return { type: 'nothing' };

  return {
    type: 'playing',
    track: {
      name: item.name,
      artists: item.artists.map((a) => a.name),
      album: item.album.name,
    },
    progress_ms: progress_ms ?? 0,
    duration_ms: item.duration_ms,
  };
}
