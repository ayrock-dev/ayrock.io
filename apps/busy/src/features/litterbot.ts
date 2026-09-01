import { Result } from 'better-result';
import * as z from 'zod/mini';
import {
  error_message,
  LitterbotAuthIncomplete,
  LitterbotMalformedResponse,
  LitterbotNonJson,
  LitterbotRequestFailed,
  LitterbotTokenInvalid,
  LitterbotUnexpectedStatus,
  type litterbot_error,
} from '../lib/errors';

/*
 * Whisker (Litter Robot) has no public API. These endpoints and constants are
 * reverse-engineered from community prior art (pylitterbot) and may change or
 * break at any time. We authenticate with username/password via AWS Cognito's
 * USER_PASSWORD_AUTH flow — a plain HTTPS POST, deliberately avoiding SRP so this
 * adapter carries no bespoke auth crypto. The id token is the bearer for both
 * the EVO REST API and the pet-profile AppSync API; the whisker user id is the
 * token's `mid` claim.
 *
 * This adapter targets the Litter-Robot EVO (type `LRE`), served by the
 * `ub.prod.iothings.site` REST API (pylitterbot's LitterRobot5 class). The
 * older LR4 GraphQL API is intentionally not supported.
 */
const LITTER_ROBOT_CLIENT_ID = '4552ujeu3aic90nf8qn53levmn';
const COGNITO_ENDPOINT = 'https://cognito-idp.us-east-1.amazonaws.com/';
const EVO_ENDPOINT = 'https://ub.prod.iothings.site';
const PET_GRAPHQL = 'https://pet-profile.iothings.site/graphql/';

const GET_PETS_QUERY = `query GetPetsByUser($userId: String!) {
  getPetsByUser(userId: $userId) {
    petId
    name
  }
}`;

export type token = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type robot = {
  serial: string;
  name: string | null;
  is_online: boolean;
  litter_level_pct: number | null;
  waste_level_pct: number | null;
};

export type activity = {
  timestamp: string;
  type: string;
  pet_id: string | null;
  pet_weight: number | null;
};

export type pet = {
  id: string;
  name: string | null;
};

const auth_result_schema = z.object({
  AuthenticationResult: z.object({
    AccessToken: z.string(),
    IdToken: z.string(),
    RefreshToken: z.optional(z.string()),
    ExpiresIn: z.number(),
  }),
});

const robots_schema = z.array(
  z.object({
    serial: z.string(),
    name: z.nullable(z.optional(z.string())),
    state: z.optional(
      z.object({
        isOnline: z.optional(z.boolean()),
        litterLevelPercent: z.nullable(z.optional(z.number())),
        dfiLevelPercent: z.nullable(z.optional(z.number())),
      }),
    ),
  }),
);

const activities_schema = z.array(
  z.object({
    timestamp: z.string(),
    type: z.string(),
    petIds: z.nullable(z.optional(z.array(z.string()))),
    petWeight: z.nullable(z.optional(z.number())),
  }),
);

const pets_schema = z.object({
  data: z.object({
    getPetsByUser: z.nullable(
      z.array(
        z.object({
          petId: z.string(),
          name: z.nullable(z.optional(z.string())),
        }),
      ),
    ),
  }),
});

function api_headers(access_token: string): Record<string, string> {
  return {
    authorization: `Bearer ${access_token}`,
    'content-type': 'application/json',
  };
}

async function initiate_auth(
  auth_flow: string,
  auth_parameters: Record<string, string>,
  refresh_token: string | null,
): Promise<Result<token, litterbot_error>> {
  const response = await Result.tryPromise({
    try: () =>
      fetch(COGNITO_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({
          AuthFlow: auth_flow,
          ClientId: LITTER_ROBOT_CLIENT_ID,
          AuthParameters: auth_parameters,
        }),
      }),
    catch: (cause) =>
      new LitterbotRequestFailed({
        message: `litterbot auth request failed before a response: ${error_message(cause)}`,
        endpoint: COGNITO_ENDPOINT,
        cause,
      }),
  });
  if (response.isErr()) return response;

  const raw = await response.value.text();
  if (!response.value.ok)
    return Result.err(
      new LitterbotUnexpectedStatus({
        message: `litterbot auth returned ${response.value.status}`,
        endpoint: COGNITO_ENDPOINT,
        status: response.value.status,
        body: raw,
      }),
    );

  const json = Result.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () =>
      new LitterbotNonJson({
        message: 'litterbot auth returned non-JSON',
        endpoint: COGNITO_ENDPOINT,
        body: raw,
      }),
  });
  if (json.isErr()) return json;

  const parsed = z.safeParse(auth_result_schema, json.value);
  if (!parsed.success)
    return Result.err(
      new LitterbotAuthIncomplete({
        message: `litterbot auth did not return tokens (a challenge may be required): ${raw}`,
      }),
    );
  const result = parsed.data.AuthenticationResult;
  const next_refresh = result.RefreshToken ?? refresh_token;
  if (next_refresh === null)
    return Result.err(
      new LitterbotAuthIncomplete({
        message: 'litterbot auth returned no refresh token',
      }),
    );
  return Result.ok({
    access_token: result.IdToken,
    refresh_token: next_refresh,
    expires_in: result.ExpiresIn,
  });
}

export function login(
  username: string,
  password: string,
): Promise<Result<token, litterbot_error>> {
  return initiate_auth(
    'USER_PASSWORD_AUTH',
    { USERNAME: username, PASSWORD: password },
    null,
  );
}

export function refresh(
  refresh_token: string,
): Promise<Result<token, litterbot_error>> {
  return initiate_auth(
    'REFRESH_TOKEN_AUTH',
    { REFRESH_TOKEN: refresh_token },
    refresh_token,
  );
}

/*
 * The whisker user id is the `mid` claim of the Cognito id token. We decode the
 * JWT payload without verifying the signature: the token was just issued to us
 * over TLS and is only used to address our own account's data.
 */
export function get_user_id(
  id_token: string,
): Result<string, LitterbotTokenInvalid> {
  const part = id_token.split('.')[1];
  if (part === undefined)
    return Result.err(
      new LitterbotTokenInvalid({
        message: 'litterbot id token is not a JWT',
      }),
    );
  const claims = Result.try({
    try: () =>
      JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as unknown,
    catch: (cause) =>
      new LitterbotTokenInvalid({
        message: `litterbot id token decode failed: ${error_message(cause)}`,
        cause,
      }),
  });
  if (claims.isErr()) return claims;
  const value = claims.value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'mid' in value &&
    typeof (value as { mid: unknown }).mid === 'string'
  )
    return Result.ok((value as { mid: string }).mid);
  return Result.err(
    new LitterbotTokenInvalid({
      message: 'litterbot id token missing mid claim',
    }),
  );
}

async function graphql(
  endpoint: string,
  access_token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Result<unknown, litterbot_error>> {
  const response = await Result.tryPromise({
    try: () =>
      fetch(endpoint, {
        method: 'POST',
        headers: api_headers(access_token),
        body: JSON.stringify({ query, variables }),
      }),
    catch: (cause) =>
      new LitterbotRequestFailed({
        message: `litterbot graphql request failed before a response: ${error_message(cause)}`,
        endpoint,
        cause,
      }),
  });
  if (response.isErr()) return response;
  if (!response.value.ok)
    return Result.err(
      new LitterbotUnexpectedStatus({
        message: `litterbot graphql returned ${response.value.status}`,
        endpoint,
        status: response.value.status,
        body: await response.value.text(),
      }),
    );
  return Result.ok(await response.value.json());
}

async function rest_get(
  url: string,
  access_token: string,
): Promise<Result<unknown, litterbot_error>> {
  const response = await Result.tryPromise({
    try: () => fetch(url, { headers: api_headers(access_token) }),
    catch: (cause) =>
      new LitterbotRequestFailed({
        message: `litterbot rest request failed before a response: ${error_message(cause)}`,
        endpoint: url,
        cause,
      }),
  });
  if (response.isErr()) return response;
  if (!response.value.ok)
    return Result.err(
      new LitterbotUnexpectedStatus({
        message: `litterbot rest returned ${response.value.status}`,
        endpoint: url,
        status: response.value.status,
        body: await response.value.text(),
      }),
    );
  return Result.ok(await response.value.json());
}

export async function get_robots(
  access_token: string,
): Promise<Result<robot[], litterbot_error>> {
  const endpoint = `${EVO_ENDPOINT}/robots`;
  const body = await rest_get(endpoint, access_token);
  if (body.isErr()) return body;
  const parsed = z.safeParse(robots_schema, body.value);
  if (!parsed.success)
    return Result.err(
      new LitterbotMalformedResponse({
        message: `unexpected litterbot robots response: ${parsed.error.message}`,
        endpoint,
      }),
    );
  return Result.ok(
    parsed.data.map((r) => ({
      serial: r.serial,
      name: r.name ?? null,
      is_online: r.state?.isOnline ?? false,
      litter_level_pct: r.state?.litterLevelPercent ?? null,
      waste_level_pct: r.state?.dfiLevelPercent ?? null,
    })),
  );
}

/*
 * EVO reports pet weight in hundredths of a pound (e.g. 723 => 7.23 lb).
 */
function to_pounds(weight: number | null | undefined): number | null {
  return weight != null && weight > 0 ? weight / 100 : null;
}

export async function get_activity(
  access_token: string,
  serial: string,
  limit = 20,
): Promise<Result<activity[], litterbot_error>> {
  const endpoint = `${EVO_ENDPOINT}/robots/${serial}/activities?limit=${limit}`;
  const body = await rest_get(endpoint, access_token);
  if (body.isErr()) return body;
  const parsed = z.safeParse(activities_schema, body.value);
  if (!parsed.success)
    return Result.err(
      new LitterbotMalformedResponse({
        message: `unexpected litterbot activity response: ${parsed.error.message}`,
        endpoint,
      }),
    );
  return Result.ok(
    parsed.data.map((a) => ({
      timestamp: a.timestamp,
      type: a.type,
      pet_id: a.petIds?.[0] ?? null,
      pet_weight: to_pounds(a.petWeight),
    })),
  );
}

export async function get_pets(
  access_token: string,
  user_id: string,
): Promise<Result<pet[], litterbot_error>> {
  const body = await graphql(PET_GRAPHQL, access_token, GET_PETS_QUERY, {
    userId: user_id,
  });
  if (body.isErr()) return body;
  const parsed = z.safeParse(pets_schema, body.value);
  if (!parsed.success)
    return Result.err(
      new LitterbotMalformedResponse({
        message: `unexpected litterbot pets response: ${parsed.error.message}`,
        endpoint: PET_GRAPHQL,
      }),
    );
  return Result.ok(
    (parsed.data.data.getPetsByUser ?? []).map((p) => ({
      id: p.petId,
      name: p.name ?? null,
    })),
  );
}

/*
 * EVO attributes visits server-side and reports the matched pet directly on the
 * PET_VISIT event via `petIds`. We resolve that id to a display name.
 */
export function attribute(pets: pet[], pet_id: string | null): string | null {
  if (pet_id === null) return null;
  return pets.find((p) => p.id === pet_id)?.name ?? null;
}
