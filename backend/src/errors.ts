/**
 * Categories of expected failure. Services name what went wrong; each transport
 * decides how to report it (see `http/errors.ts` for HTTP status codes).
 */
export type FailureKind =
  | 'invalid'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'too-large'
  | 'unsupported'
  | 'internal'
  | 'upstream';

/**
 * An expected, user-facing failure raised by a service. The message is shown
 * verbatim, so it keeps the wording the frontend already displays. `details`
 * are extra response fields, such as the sync state that accompanies a refused
 * pull.
 */
export class ServiceError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
