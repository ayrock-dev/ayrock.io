import { Result } from 'better-result';
import * as z from 'zod/mini';
import {
  error_message,
  SpotifyMalformedResponse,
  SpotifyRequestFailed,
  SpotifyUnexpectedStatus,
  type spotify_error,
} from '../lib/errors';

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

export type token = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

export type profile = {
  id: string;
  display_name: string | null;
  image_url: string | null;
};

export type now_playing =
  | {
      type: 'playing';
      uri: string;
      track: track;
      progress_ms: number;
      duration_ms: number;
    }
  | { type: 'nothing' };

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
      uri: z.string(),
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

async function get_json(
  endpoint: string,
  init: RequestInit,
): Promise<Result<unknown, spotify_error>> {
  const response = await Result.tryPromise({
    try: () => fetch(endpoint, init),
    catch: (cause) =>
      new SpotifyRequestFailed({
        message: `spotify request to ${endpoint} failed before a response: ${error_message(cause)}`,
        endpoint,
        cause,
      }),
  });
  if (response.isErr()) return response;

  if (!response.value.ok)
    return Result.err(
      new SpotifyUnexpectedStatus({
        message: `spotify ${endpoint} returned ${response.value.status}`,
        endpoint,
        status: response.value.status,
        body: await response.value.text(),
      }),
    );

  return Result.ok(await response.value.json());
}

async function post_token(
  config: config,
  body: Record<string, string>,
): Promise<Result<token, spotify_error>> {
  const endpoint = `${accounts_base}/api/token`;
  const json = await get_json(endpoint, {
    method: 'POST',
    headers: {
      authorization: basic_auth(config),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  if (json.isErr()) return json;

  const parsed = z.safeParse(token_schema, json.value);
  if (!parsed.success)
    return Result.err(
      new SpotifyMalformedResponse({
        message: `unexpected spotify token response: ${parsed.error.message}`,
        endpoint,
      }),
    );
  return Result.ok({
    access_token: parsed.data.access_token,
    expires_in: parsed.data.expires_in,
    refresh_token: parsed.data.refresh_token,
  });
}

export function exchange_code(
  config: config,
  code: string,
): Promise<Result<token, spotify_error>> {
  return post_token(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirect_uri,
  });
}

export function refresh_access_token(
  config: config,
  refresh_token: string,
): Promise<Result<token, spotify_error>> {
  return post_token(config, {
    grant_type: 'refresh_token',
    refresh_token,
  });
}

export async function get_profile(
  access_token: string,
): Promise<Result<profile, spotify_error>> {
  const endpoint = `${api_base}/me`;
  const json = await get_json(endpoint, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (json.isErr()) return json;

  const parsed = z.safeParse(profile_schema, json.value);
  if (!parsed.success)
    return Result.err(
      new SpotifyMalformedResponse({
        message: `unexpected spotify profile response: ${parsed.error.message}`,
        endpoint,
      }),
    );
  return Result.ok({
    id: parsed.data.id,
    display_name: parsed.data.display_name,
    image_url: parsed.data.images[0]?.url ?? null,
  });
}

export async function now_playing(
  access_token: string,
): Promise<Result<now_playing, spotify_error>> {
  const endpoint = `${api_base}/me/player/currently-playing`;
  const response = await Result.tryPromise({
    try: () =>
      fetch(endpoint, { headers: { authorization: `Bearer ${access_token}` } }),
    catch: (cause) =>
      new SpotifyRequestFailed({
        message: `spotify now-playing request failed before a response: ${error_message(cause)}`,
        endpoint,
        cause,
      }),
  });
  if (response.isErr()) return response;

  if (response.value.status === 204) return Result.ok({ type: 'nothing' });

  if (!response.value.ok)
    return Result.err(
      new SpotifyUnexpectedStatus({
        message: `spotify now-playing returned ${response.value.status}`,
        endpoint,
        status: response.value.status,
        body: await response.value.text(),
      }),
    );

  const parsed = z.safeParse(now_playing_schema, await response.value.json());
  if (!parsed.success)
    return Result.err(
      new SpotifyMalformedResponse({
        message: `unexpected now-playing response: ${parsed.error.message}`,
        endpoint,
      }),
    );

  const { is_playing, item, progress_ms } = parsed.data;
  if (!is_playing || !item) return Result.ok({ type: 'nothing' });

  return Result.ok({
    type: 'playing',
    uri: item.uri,
    track: {
      name: item.name,
      artists: item.artists.map((a) => a.name),
      album: item.album.name,
    },
    progress_ms: progress_ms ?? 0,
    duration_ms: item.duration_ms,
  });
}
