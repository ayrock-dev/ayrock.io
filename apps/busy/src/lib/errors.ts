import { TaggedError } from 'better-result';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function error_message(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export class EnvInvalid extends TaggedError('EnvInvalid')<{
  message: string;
  cause: unknown;
}> {}

export class BodyNotJson extends TaggedError('BodyNotJson')<{
  message: string;
  cause: unknown;
}> {}

export class BodyInvalid extends TaggedError('BodyInvalid')<{
  message: string;
  issues: unknown;
}> {}

export class QueryInvalid extends TaggedError('QueryInvalid')<{
  message: string;
}> {}

export class DbUnavailable extends TaggedError('DbUnavailable')<{
  message: string;
  cause: unknown;
}> {}

export class QueuePublishFailed extends TaggedError('QueuePublishFailed')<{
  message: string;
  cause: unknown;
}> {}

export class SpotifyRequestFailed extends TaggedError('SpotifyRequestFailed')<{
  message: string;
  endpoint: string;
  cause: unknown;
}> {}

export class SpotifyUnexpectedStatus extends TaggedError(
  'SpotifyUnexpectedStatus',
)<{
  message: string;
  endpoint: string;
  status: number;
  body: string;
}> {}

export class SpotifyMalformedResponse extends TaggedError(
  'SpotifyMalformedResponse',
)<{
  message: string;
  endpoint: string;
}> {}

export class SpotifyMissingRefreshToken extends TaggedError(
  'SpotifyMissingRefreshToken',
)<{
  message: string;
}> {}

export type spotify_error =
  | SpotifyRequestFailed
  | SpotifyUnexpectedStatus
  | SpotifyMalformedResponse;

export class LitterbotRequestFailed extends TaggedError(
  'LitterbotRequestFailed',
)<{
  message: string;
  endpoint: string;
  cause: unknown;
}> {}

export class LitterbotUnexpectedStatus extends TaggedError(
  'LitterbotUnexpectedStatus',
)<{
  message: string;
  endpoint: string;
  status: number;
  body: string;
}> {}

export class LitterbotNonJson extends TaggedError('LitterbotNonJson')<{
  message: string;
  endpoint: string;
  body: string;
}> {}

export class LitterbotMalformedResponse extends TaggedError(
  'LitterbotMalformedResponse',
)<{
  message: string;
  endpoint: string;
}> {}

export class LitterbotAuthIncomplete extends TaggedError(
  'LitterbotAuthIncomplete',
)<{
  message: string;
}> {}

export class LitterbotTokenInvalid extends TaggedError(
  'LitterbotTokenInvalid',
)<{
  message: string;
  cause?: unknown;
}> {}

export type litterbot_error =
  | LitterbotRequestFailed
  | LitterbotUnexpectedStatus
  | LitterbotNonJson
  | LitterbotMalformedResponse
  | LitterbotAuthIncomplete;

export class BusybarUploadFailed extends TaggedError('BusybarUploadFailed')<{
  message: string;
  cause: unknown;
}> {}

export class BusybarDrawFailed extends TaggedError('BusybarDrawFailed')<{
  message: string;
  cause: unknown;
}> {}

export class BusybarBusy extends TaggedError('BusybarBusy')<{
  message: string;
}> {}

export class DeviceNotFound extends TaggedError('DeviceNotFound')<{
  message: string;
  device_id: string;
}> {}

export class DeviceHasNoToken extends TaggedError('DeviceHasNoToken')<{
  message: string;
  device_id: string;
}> {}

export class ConnectionLinkFailed extends TaggedError('ConnectionLinkFailed')<{
  message: string;
}> {}

export type app_error =
  | EnvInvalid
  | BodyNotJson
  | BodyInvalid
  | DbUnavailable
  | QueuePublishFailed
  | QueryInvalid
  | spotify_error
  | SpotifyMissingRefreshToken
  | litterbot_error
  | LitterbotTokenInvalid
  | BusybarUploadFailed
  | BusybarDrawFailed
  | BusybarBusy
  | DeviceNotFound
  | DeviceHasNoToken
  | ConnectionLinkFailed;

const status_by_tag: Record<app_error['_tag'], ContentfulStatusCode> = {
  EnvInvalid: 500,
  BodyNotJson: 400,
  BodyInvalid: 400,
  DbUnavailable: 500,
  QueuePublishFailed: 502,
  QueryInvalid: 400,
  SpotifyRequestFailed: 502,
  SpotifyUnexpectedStatus: 502,
  SpotifyMalformedResponse: 502,
  SpotifyMissingRefreshToken: 502,
  LitterbotRequestFailed: 502,
  LitterbotUnexpectedStatus: 502,
  LitterbotNonJson: 502,
  LitterbotMalformedResponse: 502,
  LitterbotAuthIncomplete: 502,
  LitterbotTokenInvalid: 502,
  BusybarUploadFailed: 502,
  BusybarDrawFailed: 502,
  BusybarBusy: 409,
  DeviceNotFound: 404,
  DeviceHasNoToken: 422,
  ConnectionLinkFailed: 502,
};

export function error_status(error: app_error): ContentfulStatusCode {
  return status_by_tag[error._tag];
}

const body_field_max = 500;

/*
 * Flatten a tagged error into the queryable fields a wide event wants: the tag,
 * the human-readable `message`, and the structured context the variant carries
 * (endpoint, upstream status, device_id, ...). Built from `toJSON()` because
 * TaggedError stores `message`/`cause` as non-enumerable own properties, so
 * `Object.entries` alone silently drops them. `cause` is stringified, oversized
 * response bodies are truncated, and `issues` is dropped (it belongs in the HTTP
 * body, not as a high-cardinality event field).
 */
export function error_fields(error: app_error): Record<string, unknown> {
  const out: Record<string, unknown> = { tag: error._tag };
  for (const [key, value] of Object.entries(error.toJSON())) {
    if (key === '_tag' || key === 'name' || key === 'stack' || key === 'issues')
      continue;
    if (key === 'cause') {
      if (value !== undefined) out.cause = error_message(error.cause);
      continue;
    }
    if (key === 'body' && typeof value === 'string') {
      out.body = value.slice(0, body_field_max);
      continue;
    }
    out[key] = value;
  }
  return out;
}
