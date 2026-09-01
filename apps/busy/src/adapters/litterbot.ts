import type { Client } from '@upstash/qstash';
import { Result } from 'better-result';
import type { connection } from '../features/connections';
import * as connections from '../features/connections';
import * as devices from '../features/devices';
import * as litterbot from '../features/litterbot';
import * as workflow from '../features/workflow';
import type { litterbot_error, QueuePublishFailed } from '../lib/errors';
import {
  BusyEvent,
  type busy_event,
  device_priority,
  type draw_frame,
  type event_props,
} from '../lib/events';
import { cat_path } from '../lib/icons';
import { nanoid } from '../lib/nanoid';
import type { DbRuntime } from '../lib/prisma';

export type visit = {
  pet_name: string | null;
  pet_weight: number | null;
  litter_level_pct: number | null;
  waste_level_pct: number | null;
  visit_at: string;
};

function subtitle(v: visit): string {
  if (v.pet_weight !== null) return `${v.pet_weight.toFixed(2)} lbs`;
  if (v.litter_level_pct !== null)
    return `Litter ${Math.round(v.litter_level_pct)}%`;
  return 'Used';
}

export class LitterbotEvent extends BusyEvent {
  private readonly visit: visit;
  private readonly timeout_s: number;

  constructor(props: event_props & { visit: visit; timeout: number }) {
    super(props);
    this.visit = props.visit;
    this.timeout_s = props.timeout;
  }

  render(): draw_frame {
    const text_x = 18;
    const text_width = 72 - text_x;
    const timeout_s = this.timeout_s;
    const title = this.visit.pet_name ?? 'Cat visited';
    return {
      priority: this.priority,
      elements: [
        {
          id: 'cat',
          type: 'image',
          path: cat_path(this.visit.pet_name),
          x: 0,
          y: 0,
          display: 'front',
          opacity: 100,
          timeout: timeout_s,
        },
        {
          id: 'lb_title',
          type: 'text',
          text: title,
          x: text_x,
          y: 1,
          display: 'front',
          font: 'small',
          color: '#FFFFFFFF',
          width: text_width,
          scroll_rate: 600,
          timeout: timeout_s,
        },
        {
          id: 'lb_subtitle',
          type: 'text',
          text: subtitle(this.visit),
          x: text_x,
          y: 9,
          display: 'front',
          font: 'small',
          color: '#B3B3B3FF',
          width: text_width,
          scroll_rate: 600,
          timeout: timeout_s,
        },
      ],
    };
  }
}

const timeout_s = 30;
const poll_grace_s = 90;
const used_types = new Set(['PET_VISIT']);

export function to_event(device_id: string, v: visit): busy_event {
  return {
    type: 'litterbot',
    device_id,
    priority: device_priority.neutral,
    timeout: timeout_s,
    pet_name: v.pet_name,
    pet_weight: v.pet_weight,
    litter_level_pct: v.litter_level_pct,
    waste_level_pct: v.waste_level_pct,
  };
}

export type poll_deps = {
  qstash: Client;
  poll_url: string;
  workflow_url: string;
};

/*
 * `Result.ok(token)` when live or refreshed, `Result.ok(null)` when expired with no refresh
 * token (legal not-linked state), `err` only on a genuine upstream refresh
 * fault.
 */
async function token_for(
  rt: DbRuntime,
  conn: connection,
): Promise<Result<string | null, litterbot_error>> {
  if (conn.expires_at.getTime() > Date.now() + 10_000)
    return Result.ok(conn.access_token);
  if (conn.refresh_token === null) return Result.ok(null);

  const result = await litterbot.refresh(conn.refresh_token);
  if (result.isErr()) return result;

  await connections.set_litterbot_auth(rt, conn.user_id, {
    access_token: result.value.access_token,
    refresh_token: result.value.refresh_token,
    expires_at: new Date(Date.now() + result.value.expires_in * 1000),
  });
  return Result.ok(result.value.access_token);
}

async function schedule(
  rt: DbRuntime,
  deps: poll_deps,
  connection_id: string,
  delay_s: number,
): Promise<Result<void, QueuePublishFailed>> {
  const event_id = nanoid();
  await connections.set_poll_state(rt, connection_id, {
    event_id,
    next_event_at: new Date(Date.now() + (delay_s + poll_grace_s) * 1000),
  });
  const published = await workflow.publish_poll(deps.qstash, deps.poll_url, {
    connection_id,
    event_id,
    delay_s,
  });
  if (published.isErr()) {
    await connections.set_poll_state(rt, connection_id, {
      event_id: null,
      next_event_at: null,
    });
    return published;
  }
  return Result.ok(undefined);
}

async function drop(rt: DbRuntime, connection_id: string): Promise<void> {
  await connections.set_poll_state(rt, connection_id, {
    event_id: null,
    next_event_at: null,
  });
}

async function publish(
  rt: DbRuntime,
  deps: poll_deps,
  conn: connection,
  v: visit,
): Promise<Result<void, QueuePublishFailed>> {
  for (const device of await devices.all(rt, conn.user_id)) {
    if (device.access_token === null) continue;
    const enqueued = await workflow.enqueue(
      deps.qstash,
      deps.workflow_url,
      to_event(device.id, v),
    );
    if (enqueued.isErr()) return enqueued;
  }
  return Result.ok(undefined);
}

export type poll_outcome =
  | { status: 'primed' }
  | { status: 'visited' }
  | { status: 'idle' }
  | { status: 'superseded' }
  | { status: 'unknown' }
  | { status: 'no_token' }
  | { status: 'error'; reason: string };

type detected = { v: visit; pet_id: string | null } | null;

async function scan(
  access_token: string,
  robots: litterbot.robot[],
  cursor: string | null,
): Promise<
  Result<{ newest: string | null; detected: detected }, litterbot_error>
> {
  let newest = cursor;
  let best: { at: number; v: visit; pet_id: string | null } | null = null;

  for (const robot of robots) {
    const activities = await litterbot.get_activity(access_token, robot.serial);
    if (activities.isErr()) return activities;

    for (const a of activities.value) {
      const at = Date.parse(a.timestamp);
      if (Number.isNaN(at)) continue;
      if (newest === null || at > Date.parse(newest)) newest = a.timestamp;
      if (cursor === null || at <= Date.parse(cursor)) continue;
      if (!used_types.has(a.type)) continue;
      if (best !== null && at <= best.at) continue;
      best = {
        at,
        pet_id: a.pet_id,
        v: {
          pet_name: null,
          pet_weight: a.pet_weight,
          litter_level_pct: robot.litter_level_pct,
          waste_level_pct: robot.waste_level_pct,
          visit_at: a.timestamp,
        },
      };
    }
  }

  return Result.ok({
    newest,
    detected: best ? { v: best.v, pet_id: best.pet_id } : null,
  });
}

/*
 * Drive one litterbot poll cycle. Expected states are returned as values so the
 * queue consumer acks them; an upstream whisker fault becomes `error` (the
 * schedule is dropped and the next cron tick re-arms). Only a queue publish
 * failure escapes as `Err` for a legitimate qstash retry.
 */
export async function handle_poll(
  rt: DbRuntime,
  deps: poll_deps,
  payload: { connection_id: string; event_id: string },
): Promise<Result<poll_outcome, QueuePublishFailed>> {
  const conn = await connections.get_by_id(rt, payload.connection_id);
  if (conn?.type !== 'litterbot') return Result.ok({ status: 'unknown' });
  if (conn.event_id !== payload.event_id)
    return Result.ok({ status: 'superseded' });

  const token = await token_for(rt, conn);
  if (token.isErr()) {
    await drop(rt, conn.id);
    return Result.ok({ status: 'error', reason: token.error.message });
  }
  if (!token.value) {
    await drop(rt, conn.id);
    return Result.ok({ status: 'no_token' });
  }
  const access_token = token.value;

  const robots = await litterbot.get_robots(access_token);
  if (robots.isErr()) {
    await drop(rt, conn.id);
    return Result.ok({ status: 'error', reason: robots.error.message });
  }

  const result = await scan(access_token, robots.value, conn.cursor);
  if (result.isErr()) {
    await drop(rt, conn.id);
    return Result.ok({ status: 'error', reason: result.error.message });
  }

  await connections.set_cursor(rt, conn.id, result.value.newest);
  await drop(rt, conn.id);

  if (conn.cursor === null) return Result.ok({ status: 'primed' });
  if (result.value.detected === null) return Result.ok({ status: 'idle' });

  const { v, pet_id } = result.value.detected;
  let pet_name: string | null = null;
  if (pet_id !== null) {
    const user_id = litterbot.get_user_id(access_token);
    if (user_id.isOk()) {
      const pets = await litterbot.get_pets(access_token, user_id.value);
      if (pets.isOk()) pet_name = litterbot.attribute(pets.value, pet_id);
    }
  }

  const published = await publish(rt, deps, conn, { ...v, pet_name });
  if (published.isErr()) return published;
  return Result.ok({ status: 'visited' });
}

export async function ensure_scheduled(
  rt: DbRuntime,
  deps: poll_deps,
  conn: connection,
): Promise<Result<void, QueuePublishFailed>> {
  const alive =
    conn.event_id !== null &&
    conn.next_event_at !== null &&
    conn.next_event_at.getTime() > Date.now();
  if (alive) return Result.ok(undefined);
  return schedule(rt, deps, conn.id, 0);
}
