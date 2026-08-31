import { Client } from '@upstash/qstash';
import type { Env } from './env.ts';

export const event_queue_name = 'busy-events';

export function make_qstash(env: Env): Client {
  return new Client({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL });
}
