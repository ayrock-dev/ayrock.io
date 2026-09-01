import type { Client } from '@upstash/qstash';
import { Result } from 'better-result';
import { DebugEvent } from '../adapters/debug';
import { LitterbotEvent } from '../adapters/litterbot';
import { SpotifyEvent } from '../adapters/spotify';
import { error_message, QueuePublishFailed } from '../lib/errors';
import type { busy_event, draw_frame } from '../lib/events';
import type { DbRuntime } from '../lib/prisma';
import { event_queue_name } from '../lib/upstash';
import * as busybar from './busybar';
import * as devices from './devices';

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

export function enqueue(
  qstash: Client,
  url: string,
  event: busy_event,
): Promise<Result<void, QueuePublishFailed>> {
  return Result.tryPromise({
    try: async () => {
      await qstash
        .queue({ queueName: event_queue_name })
        .enqueueJSON({ url, body: event, retries: 3 });
    },
    catch: (cause) =>
      new QueuePublishFailed({
        message: `failed to enqueue draw event for device ${event.device_id}: ${error_message(cause)}`,
        cause,
      }),
  });
}

export function publish_poll(
  qstash: Client,
  url: string,
  payload: { connection_id: string; event_id: string; delay_s: number },
): Promise<Result<void, QueuePublishFailed>> {
  return Result.tryPromise({
    try: async () => {
      await qstash.publishJSON({
        url,
        body: {
          connection_id: payload.connection_id,
          event_id: payload.event_id,
        },
        delay: payload.delay_s,
        deduplicationId: payload.event_id,
        retries: 3,
      });
    },
    catch: (cause) =>
      new QueuePublishFailed({
        message: `failed to schedule poll for connection ${payload.connection_id}: ${error_message(cause)}`,
        cause,
      }),
  });
}

export type draw_result =
  | { status: 'ok' }
  | { status: 'no_token' }
  | { status: 'conflict' }
  | { status: 'draw_failed'; message: string };

/*
 * Draw a single event. Expected, non-retryable outcomes (missing token, busy
 * display, a frame the device rejects) are returned as values so the queue
 * consumer can ack them. Only unexpected faults (e.g. DB access) propagate.
 */
export async function handle(
  rt: DbRuntime,
  event: busy_event,
): Promise<draw_result> {
  const device = await devices.get(rt, event.device_id);
  const token = device?.access_token ?? null;
  if (!token) return { status: 'no_token' };

  const drawn = await busybar.draw(token, render(event));
  return drawn.match({
    ok: (): draw_result => ({ status: 'ok' }),
    err: (error): draw_result =>
      error._tag === 'BusybarBusy'
        ? { status: 'conflict' }
        : { status: 'draw_failed', message: error.message },
  });
}
