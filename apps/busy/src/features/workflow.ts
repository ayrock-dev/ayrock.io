import type { Client } from '@upstash/qstash';
import { DebugEvent } from '../adapters/debug';
import { LitterbotEvent } from '../adapters/litterbot';
import { SpotifyEvent } from '../adapters/spotify';
import type { busy_event, draw_frame } from '../lib/events';
import type { DbRuntime } from '../lib/prisma';
import { event_queue_name } from '../lib/upstash';
import * as busybar from './busybar';
import * as devices from './devices';

function is_conflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 409
  );
}

function render(event: busy_event): draw_frame {
  switch (event.type) {
    case 'spotify':
      return new SpotifyEvent({
        device_id: event.device_id,
        source: 'spotify',
        priority: event.priority,
        track: event.track,
        timeout: event.timeout,
      }).render();
    case 'litterbot':
      return new LitterbotEvent({
        device_id: event.device_id,
        source: 'litterbot',
        priority: event.priority,
        timeout: event.timeout,
        visit: {
          pet_name: event.pet_name,
          pet_weight: event.pet_weight,
          litter_level_pct: event.litter_level_pct,
          waste_level_pct: event.waste_level_pct,
          visit_at: '',
        },
      }).render();
    case 'debug':
      return new DebugEvent({
        device_id: event.device_id,
        source: 'debug',
        priority: event.priority,
        elements: event.elements,
      }).render();
  }
}

export async function enqueue(
  qstash: Client,
  url: string,
  event: busy_event,
): Promise<void> {
  await qstash
    .queue({ queueName: event_queue_name })
    .enqueueJSON({ url, body: event, retries: 3 });
}

export type draw_result =
  | { status: 'ok' }
  | { status: 'no_token' }
  | { status: 'conflict' };

export async function handle(
  rt: DbRuntime,
  event: busy_event,
): Promise<draw_result> {
  const device = await devices.get(rt, event.device_id);
  const token = device?.access_token ?? null;
  if (!token) return { status: 'no_token' };
  try {
    await busybar.draw(token, render(event));
    return { status: 'ok' };
  } catch (error) {
    if (is_conflict(error)) return { status: 'conflict' };
    throw error;
  }
}
