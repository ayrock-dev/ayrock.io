import * as z from 'zod/mini';

/*
 * Whisker (Litter Robot) has no public API. These endpoints and constants are
 * reverse-engineered from community prior art (pylitterbot, homebridge-litter-robot)
 * and may change or break at any time. We authenticate via an OAuth2 password
 * grant (username/password) — we deliberately avoid Whisker's newer Cognito/SRP
 * flow to keep this adapter free of bespoke auth crypto.
 */
export const LITTER_ROBOT_CLIENT_ID = 'IYXzWN908psOm7sNpe4G.ios.whisker.robots';
const LITTER_ROBOT_CLIENT_SECRET = 'C63CLXOmwNaqLTB2xXo6QIWGwwBamcPuaul';
export const LITTER_ROBOT_API_PUBLIC_KEY =
  'p7ndMoj61npRZP5CVz9v4Uj0bG769xy6758QRBPb';

const TOKEN_ENDPOINT = 'https://autopets.sso.iothings.site/oauth/token';
const V2_BASE = 'https://v2.api.whisker.iothings.site';
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

const token_schema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

const user_schema = z.object({
  user: z.object({ userId: z.string() }),
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
    'x-api-key': LITTER_ROBOT_API_PUBLIC_KEY,
    'content-type': 'application/json',
  };
}

async function post_token(body: Record<string, string>): Promise<token_result> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': LITTER_ROBOT_API_PUBLIC_KEY,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: LITTER_ROBOT_CLIENT_ID,
        client_secret: LITTER_ROBOT_CLIENT_SECRET,
        ...body,
      }).toString(),
    });
  } catch (error) {
    return {
      type: 'error',
      message: `litterbot token request failed: ${String(error)}`,
    };
  }
  if (!response.ok) {
    return {
      type: 'error',
      message: `litterbot token endpoint returned ${response.status}: ${await response.text()}`,
    };
  }
  const parsed = z.safeParse(token_schema, await response.json());
  if (!parsed.success) {
    return {
      type: 'error',
      message: `unexpected litterbot token response: ${parsed.error.message}`,
    };
  }
  return { type: 'ok', token: parsed.data };
}

export function login(
  username: string,
  password: string,
): Promise<token_result> {
  return post_token({ grant_type: 'password', username, password });
}

export function refresh(refresh_token: string): Promise<token_result> {
  return post_token({ grant_type: 'refresh_token', refresh_token });
}

export async function get_user_id(
  access_token: string,
): Promise<string | fetch_error> {
  let response: Response;
  try {
    response = await fetch(`${V2_BASE}/users`, {
      headers: api_headers(access_token),
    });
  } catch (error) {
    return {
      type: 'error',
      message: `litterbot users request failed: ${String(error)}`,
    };
  }
  if (!response.ok)
    return {
      type: 'error',
      message: `litterbot users endpoint returned ${response.status}`,
    };
  const parsed = z.safeParse(user_schema, await response.json());
  if (!parsed.success)
    return {
      type: 'error',
      message: `unexpected litterbot users response: ${parsed.error.message}`,
    };
  return parsed.data.user.userId;
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
