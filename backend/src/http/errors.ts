import { ServiceError, errorMessage, type FailureKind } from '../errors.ts';
import { UpstreamStatusError } from '../legacy/client.ts';
import { json } from './response.ts';

const statuses: Record<FailureKind, number> = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  'too-large': 413,
  unsupported: 415,
  internal: 500,
  upstream: 502,
};

/**
 * The single mapping from thrown errors to HTTP responses. Unexpected errors use
 * the route's fallback status because Go's handlers differ (400 for reads, 500
 * for file writes, 502 for Git). A request whose client went away gets 499.
 */
export function errorResponse(
  error: unknown,
  signal: AbortSignal,
  fallbackStatus: number,
): Response {
  if (signal.aborted) return new Response(null, { status: 499 });
  if (error instanceof ServiceError)
    return json({ error: error.message, ...error.details }, statuses[error.kind]);
  if (error instanceof UpstreamStatusError) return json({ error: error.message }, error.status);
  return json({ error: errorMessage(error) }, fallbackStatus);
}
