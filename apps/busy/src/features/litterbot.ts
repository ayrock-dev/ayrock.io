import * as z from 'zod/mini';

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

export type token_result =
  | { type: 'ok'; token: token }
  | { type: 'error'; message: string };

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

export type fetch_error = { type: 'error'; message: string };

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
): Promise<token_result> {
  let response: Response;
  try {
    response = await fetch(COGNITO_ENDPOINT, {
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
    });
  } catch (error) {
    return {
      type: 'error',
      message: `litterbot auth request failed: ${String(error)}`,
    };
  }
  const raw = await response.text();
  if (!response.ok)
    return {
      type: 'error',
      message: `litterbot auth returned ${response.status}: ${raw}`,
    };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      type: 'error',
      message: `litterbot auth returned non-JSON: ${raw}`,
    };
  }
  const parsed = z.safeParse(auth_result_schema, json);
  if (!parsed.success)
    return {
      type: 'error',
      message: `litterbot auth did not return tokens (a challenge may be required): ${raw}`,
    };
  const result = parsed.data.AuthenticationResult;
  const next_refresh = result.RefreshToken ?? refresh_token;
  if (next_refresh === null)
    return {
      type: 'error',
      message: 'litterbot auth returned no refresh token',
    };
  return {
    type: 'ok',
    token: {
      access_token: result.IdToken,
      refresh_token: next_refresh,
      expires_in: result.ExpiresIn,
    },
  };
}

export function login(
  username: string,
  password: string,
): Promise<token_result> {
  return initiate_auth(
    'USER_PASSWORD_AUTH',
    { USERNAME: username, PASSWORD: password },
    null,
  );
}

export function refresh(refresh_token: string): Promise<token_result> {
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
export function get_user_id(id_token: string): string | fetch_error {
  const part = id_token.split('.')[1];
  if (part === undefined)
    return { type: 'error', message: 'litterbot id token is not a JWT' };
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims: unknown = JSON.parse(json);
    if (
      typeof claims === 'object' &&
      claims !== null &&
      'mid' in claims &&
      typeof (claims as { mid: unknown }).mid === 'string'
    )
      return (claims as { mid: string }).mid;
    return { type: 'error', message: 'litterbot id token missing mid claim' };
  } catch (error) {
    return {
      type: 'error',
      message: `litterbot id token decode failed: ${String(error)}`,
    };
  }
}

async function graphql(
  endpoint: string,
  access_token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown | fetch_error> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: api_headers(access_token),
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    return {
      type: 'error',
      message: `litterbot graphql request failed: ${String(error)}`,
    };
  }
  if (!response.ok)
    return {
      type: 'error',
      message: `litterbot graphql returned ${response.status}: ${await response.text()}`,
    };
  return response.json();
}

async function rest_get(
  url: string,
  access_token: string,
): Promise<unknown | fetch_error> {
  let response: Response;
  try {
    response = await fetch(url, { headers: api_headers(access_token) });
  } catch (error) {
    return {
      type: 'error',
      message: `litterbot rest request failed: ${String(error)}`,
    };
  }
  if (!response.ok)
    return {
      type: 'error',
      message: `litterbot rest returned ${response.status}: ${await response.text()}`,
    };
  return response.json();
}

function is_error(value: unknown): value is fetch_error {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type: unknown }).type === 'error'
  );
}

export async function get_robots(
  access_token: string,
): Promise<robot[] | fetch_error> {
  const body = await rest_get(`${EVO_ENDPOINT}/robots`, access_token);
  if (is_error(body)) return body;
  const parsed = z.safeParse(robots_schema, body);
  if (!parsed.success)
    return {
      type: 'error',
      message: `unexpected litterbot robots response: ${parsed.error.message}`,
    };
  return parsed.data.map((r) => ({
    serial: r.serial,
    name: r.name ?? null,
    is_online: r.state?.isOnline ?? false,
    litter_level_pct: r.state?.litterLevelPercent ?? null,
    waste_level_pct: r.state?.dfiLevelPercent ?? null,
  }));
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
): Promise<activity[] | fetch_error> {
  const body = await rest_get(
    `${EVO_ENDPOINT}/robots/${serial}/activities?limit=${limit}`,
    access_token,
  );
  if (is_error(body)) return body;
  const parsed = z.safeParse(activities_schema, body);
  if (!parsed.success)
    return {
      type: 'error',
      message: `unexpected litterbot activity response: ${parsed.error.message}`,
    };
  return parsed.data.map((a) => ({
    timestamp: a.timestamp,
    type: a.type,
    pet_id: a.petIds?.[0] ?? null,
    pet_weight: to_pounds(a.petWeight),
  }));
}

export async function get_pets(
  access_token: string,
  user_id: string,
): Promise<pet[] | fetch_error> {
  const body = await graphql(PET_GRAPHQL, access_token, GET_PETS_QUERY, {
    userId: user_id,
  });
  if (is_error(body)) return body;
  const parsed = z.safeParse(pets_schema, body);
  if (!parsed.success)
    return {
      type: 'error',
      message: `unexpected litterbot pets response: ${parsed.error.message}`,
    };
  return (parsed.data.data.getPetsByUser ?? []).map((p) => ({
    id: p.petId,
    name: p.name ?? null,
  }));
}

/*
 * EVO attributes visits server-side and reports the matched pet directly on the
 * PET_VISIT event via `petIds`. We resolve that id to a display name.
 */
export function attribute(pets: pet[], pet_id: string | null): string | null {
  if (pet_id === null) return null;
  return pets.find((p) => p.id === pet_id)?.name ?? null;
}
