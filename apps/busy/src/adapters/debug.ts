import type { DisplayElements } from '@busy-app/busy-lib';
import {
  BusyEvent,
  type busy_event,
  type draw_frame,
  type event_props,
} from '../lib/events';

export type debug_ingest = {
  device_id: string;
  priority?: number;
  elements: DisplayElements['elements'];
};

export class DebugEvent extends BusyEvent {
  private readonly elements: DisplayElements['elements'];

  constructor(props: event_props & { elements: DisplayElements['elements'] }) {
    super(props);
    this.elements = props.elements;
  }

  render(): draw_frame {
    return { priority: this.priority, elements: this.elements };
  }
}

export function ingest(input: debug_ingest): busy_event {
  return {
    type: 'debug',
    device_id: input.device_id,
    priority: input.priority ?? 50,
    elements: input.elements,
  };
}
