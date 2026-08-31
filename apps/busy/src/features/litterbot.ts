import * as z from 'zod/mini';

/*
 * Whisker (Litter Robot) has no public API. These endpoints and constants are
 * reverse-engineered from community prior art (pylitterbot) and may change or
 * break at any time. We authenticate with username/password via AWS Cognito's
 * USER_PASSWORD_AUTH flow — a plain HTTPS POST, deliberately avoiding SRP so this
 * adapter carries no bespoke auth crypto. The id token is the bearer for the
 * AppSync GraphQL APIs; the whisker user id is the token's `mid` claim.
 */
const LITTER_ROBOT_CLIENT_ID = '4552ujeu3aic90nf8qn53levmn';
const COGNITO_ENDPOINT = 'https://cognito-idp.us-east-1.amazonaws.com/';
const LR4_GRAPHQL = 'https://lr4.iothings.site/graphql';
const PET_GRAPHQL = 'https://pet-profile.iothings.site/graphql/';

const ROBOT_STATUS_FIELDS = `
  serial
  name
  isOnline
  catWeight
  litterLevelPercentage
  DFILevelPercent
`;

const GET_ROBOTS_QUERY = `query GetLR4ByUser($userId: String!) {
  getLitterRobot4ByUser(userId: $userId) {${ROBOT_STATUS_FIELDS}}
}`;

const GET_ACTIVITY_QUERY = `query GetLR4Activity($serial: String!, $limit: Int, $consumer: String) {
  getLitterRobot4Activity(serial: $serial, limit: $limit, consumer: $consumer) {
    timestamp
    value
    actionValue
  }
}`;

const GET_PETS_QUERY = `query GetPetsByUser($userId: String!) {
  getPetsByUser(userId: $userId) {
    petId
    name
    weightHistory { weight timestamp }
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
  pet_weight: number | null;
  litter_level_pct: number | null;
  waste_level_pct: number | null;
};

export type activity = {
  timestamp: string;
  value: string;
  action_value: string | null;
};

export type weight_reading = { weight: number; timestamp: string };
export type pet = {
  id: string;
  name: string | null;
  weights: weight_reading[];
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

const robots_schema = z.object({
  data: z.object({
    getLitterRobot4ByUser: z.nullable(
      z.array(
        z.object({
          serial: z.string(),
          name: z.nullable(z.optional(z.string())),
          isOnline: z.optional(z.boolean()),
          catWeight: z.nullable(z.optional(z.number())),
          litterLevelPercentage: z.nullable(z.optional(z.number())),
          DFILevelPercent: z.nullable(z.optional(z.number())),
        }),
      ),
    ),
  }),
});

const activity_schema = z.object({
  data: z.object({
    getLitterRobot4Activity: z.nullable(
      z.array(
        z.object({
          timestamp: z.string(),
          value: z.string(),
          actionValue: z.nullable(z.optional(z.string())),
        }),
      ),
    ),
  }),
});

const pets_schema = z.object({
  data: z.object({
    getPetsByUser: z.nullable(
      z.array(
        z.object({
          petId: z.string(),
          name: z.nullable(z.optional(z.string())),
          weightHistory: z.nullable(
            z.optional(
              z.array(z.object({ weight: z.number(), timestamp: z.string() })),
            ),
          ),
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
  user_id: string,
): Promise<robot[] | fetch_error> {
  const body = await graphql(LR4_GRAPHQL, access_token, GET_ROBOTS_QUERY, {
    userId: user_id,
  });
  if (is_error(body)) return body;
  const parsed = z.safeParse(robots_schema, body);
  if (!parsed.success)
    return {
      type: 'error',
      message: `unexpected litterbot robots response: ${parsed.error.message}`,
    };
  return (parsed.data.data.getLitterRobot4ByUser ?? []).map((r) => ({
    serial: r.serial,
    name: r.name ?? null,
    is_online: r.isOnline ?? false,
    pet_weight: r.catWeight && r.catWeight > 0 ? r.catWeight : null,
    litter_level_pct:
      r.litterLevelPercentage != null ? r.litterLevelPercentage * 100 : null,
    waste_level_pct: r.DFILevelPercent ?? null,
  }));
}

export async function get_activity(
  access_token: string,
  serial: string,
  limit = 20,
): Promise<activity[] | fetch_error> {
  const body = await graphql(LR4_GRAPHQL, access_token, GET_ACTIVITY_QUERY, {
    serial,
    limit,
    consumer: 'app',
  });
  if (is_error(body)) return body;
  const parsed = z.safeParse(activity_schema, body);
  if (!parsed.success)
    return {
      type: 'error',
      message: `unexpected litterbot activity response: ${parsed.error.message}`,
    };
  return (parsed.data.data.getLitterRobot4Activity ?? []).map((a) => ({
    timestamp: a.timestamp,
    value: a.value,
    action_value: a.actionValue ?? null,
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
    weights: p.weightHistory ?? [],
  }));
}

/*
 * Best-effort attribution. Whisker performs the probabilistic weight matching
 * server-side; the result surfaces as a weight-history entry on the attributed
 * pet. We only join a visit to a pet when that entry already exists near the
 * visit timestamp. No probabilistic logic runs here.
 */
const ATTRIBUTION_WINDOW_MS = 5 * 60_000;

export function attribute(pets: pet[], visit_at: string): string | null {
  const visit_ms = Date.parse(visit_at);
  if (Number.isNaN(visit_ms)) return null;
  for (const pet of pets) {
    for (const reading of pet.weights) {
      const reading_ms = Date.parse(reading.timestamp);
      if (Number.isNaN(reading_ms)) continue;
      if (Math.abs(reading_ms - visit_ms) <= ATTRIBUTION_WINDOW_MS)
        return pet.name;
    }
  }
  return null;
}
