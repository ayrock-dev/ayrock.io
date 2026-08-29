import type { DisplayElements } from '@busy-app/busy-lib';
import * as z from 'zod/mini';
import { nanoid } from './nanoid';

export type priority = 'low' | 'neutral' | 'high' | 'urgent';

export const device_priority: Record<priority, number> = {
  low: 20,
  neutral: 40,
  high: 70,
  urgent: 95,
};

export type draw_frame = {
  priority: number;
  elements: DisplayElements['elements'];
};

export type event_props = {
  id?: string;
  device_id: string;
  source: string;
  priority: number;
  ttl_ms?: number;
};

const element_schema = z.custom<DisplayElements['elements'][number]>(
  (v) => typeof v === 'object' && v !== null && 'id' in v && 'type' in v,
);

export const busy_event_schema = z.union([
  z.object({
    type: z.literal('spotify'),
    device_id: z.string(),
    priority: z.number(),
    timeout: z.number(),
    track: z.object({
      name: z.string(),
      artists: z.array(z.string()),
      album: z.string(),
    }),
  }),
  z.object({
    type: z.literal('debug'),
    device_id: z.string(),
    priority: z.number(),
    elements: z.array(element_schema),
  }),
]);

export type busy_event = z.infer<typeof busy_event_schema>;

export abstract class BusyEvent {
  readonly id: string;
  readonly device_id: string;
  readonly source: string;
  readonly priority: number;
  readonly created_at: number;
  readonly ttl_ms: number;

  constructor(props: event_props) {
    this.id = props.id ?? nanoid();
    this.device_id = props.device_id;
    this.source = props.source;
    this.priority = props.priority;
    this.created_at = Date.now();
    this.ttl_ms = props.ttl_ms ?? 60_000;
  }

  abstract render(): draw_frame;
}
