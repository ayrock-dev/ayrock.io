import { BusyBar } from '@busy-app/busy-lib';
import type { draw_frame } from '../lib/events';

const proxy_addr = 'https://api.busy.app';
const application_name = 'ayrock';

function client(token: string): BusyBar {
  return new BusyBar({ addr: proxy_addr, token });
}

export async function draw(token: string, frame: draw_frame): Promise<void> {
  await client(token).DisplayDraw({
    application_name,
    priority: frame.priority,
    elements: frame.elements,
  });
}

export async function clear(token: string): Promise<void> {
  await client(token).DisplayClear({ application_name });
}
