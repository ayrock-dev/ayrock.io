import { BusyBar } from '@busy-app/busy-lib';
import { Result } from 'better-result';
import {
  BusybarBusy,
  BusybarDrawFailed,
  BusybarUploadFailed,
  error_message,
} from '../lib/errors';
import type { draw_frame } from '../lib/events';
import { all_assets } from '../lib/icons';

const proxy_addr = 'https://api.busy.app';
const application_name = 'ayrock';

function client(token: string): BusyBar {
  return new BusyBar({ addr: proxy_addr, token });
}

function is_conflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 409
  );
}

/*
 * Idempotently upload the full static asset catalog to the device. Uploads
 * overwrite by path, so repeated calls converge to the same on-device state.
 * Called at device registration and via manual refresh, never per draw.
 */
export function sync_assets(
  token: string,
): Promise<Result<void, BusybarUploadFailed>> {
  return Result.tryPromise({
    try: async () => {
      const bar = client(token);
      for (const asset of all_assets()) {
        await bar.AssetsUpload({
          application_name,
          file: asset.path,
          data: asset.data.buffer as ArrayBuffer,
        });
      }
    },
    catch: (cause) =>
      new BusybarUploadFailed({
        message: `asset upload to busy bar failed; on-device assets may be partially updated: ${error_message(cause)}`,
        cause,
      }),
  });
}

/*
 * Draw a frame, replacing whatever this app previously drew. The device merges
 * elements by id within an application_name, so events with different element
 * ids (e.g. spotify vs litterbot) would otherwise stack on screen. Clearing the
 * app's canvas first makes each draw a wholesale replace.
 */
export async function draw(
  token: string,
  frame: draw_frame,
): Promise<Result<void, BusybarDrawFailed | BusybarBusy>> {
  const drawn = await Result.tryPromise({
    try: async () => {
      const bar = client(token);
      await bar.DisplayClear({ application_name });
      await bar.DisplayDraw({
        application_name,
        priority: frame.priority,
        elements: frame.elements,
      });
    },
    catch: (cause) => cause,
  });
  if (drawn.isErr()) {
    if (is_conflict(drawn.error))
      return Result.err(
        new BusybarBusy({
          message:
            'busy bar rejected the draw because a higher-priority app owns the display',
        }),
      );
    return Result.err(
      new BusybarDrawFailed({
        message: `busy bar draw failed: ${error_message(drawn.error)}`,
        cause: drawn.error,
      }),
    );
  }
  return Result.ok(undefined);
}

export function clear(token: string): Promise<Result<void, BusybarDrawFailed>> {
  return Result.tryPromise({
    try: () => client(token).DisplayClear({ application_name }),
    catch: (cause) =>
      new BusybarDrawFailed({
        message: `busy bar clear failed: ${error_message(cause)}`,
        cause,
      }),
  }).then((r) => r.map(() => undefined));
}
