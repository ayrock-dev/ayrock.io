import { BusyBar } from '@busy-app/busy-lib';
import type { draw_frame } from '../lib/events';
import { all_assets } from '../lib/icons';

const proxy_addr = 'https://api.busy.app';
const application_name = 'ayrock';

function client(token: string): BusyBar {
  return new BusyBar({ addr: proxy_addr, token });
}

/*
 * Idempotently upload the full static asset catalog to the device. Uploads
 * overwrite by path, so repeated calls converge to the same on-device state.
 * Called at device registration and via manual refresh, never per draw.
 */
export async function sync_assets(token: string): Promise<void> {
  const bar = client(token);
  for (const asset of all_assets()) {
    await bar.AssetsUpload({
      application_name,
      file: asset.path,
      data: asset.data.buffer as ArrayBuffer,
    });
  }
}

/*
 * Draw a frame, replacing whatever this app previously drew. The device merges
 * elements by id within an application_name, so events with different element
 * ids (e.g. spotify vs litterbot) would otherwise stack on screen. Clearing the
 * app's canvas first makes each draw a wholesale replace.
 */
export async function draw(token: string, frame: draw_frame): Promise<void> {
  const bar = client(token);
  await bar.DisplayClear({ application_name });
  await bar.DisplayDraw({
    application_name,
    priority: frame.priority,
    elements: frame.elements,
  });
}

export async function clear(token: string): Promise<void> {
  await client(token).DisplayClear({ application_name });
}
