import { extname } from 'node:path';
import { record, string } from '../decode.ts';
import { decodeSymbols } from '../symbols/decode.ts';

/** A failure the hidden Go server reported, kept with its HTTP status for the caller. */
export class UpstreamStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * HTTP client for the hidden Go server that still owns LSP, agents and threads.
 * All requests share one abort signal so shutdown cancels them together.
 */
export class LegacyClient {
  private readonly controller = new AbortController();

  constructor(
    readonly origin: string,
    readonly base: string,
  ) {}

  url(route: string): string {
    return this.origin + this.base + route;
  }

  /** GET a route that must succeed, decoded as JSON. */
  async value(route: string): Promise<unknown> {
    const response = await fetch(this.url(route), { signal: this.controller.signal });
    if (!response.ok) throw new Error('legacy ' + route + ': HTTP ' + response.status);
    const value: unknown = await response.json();
    return value;
  }

  /** GET a route whose error body and status are passed on to the caller. */
  async object(route: string): Promise<Record<string, unknown>> {
    const response = await fetch(this.url(route), { signal: this.controller.signal });
    const value: unknown = await response.json();
    const fields = record(value);
    if (!response.ok) throw new UpstreamStatusError(response.status, string(fields.error));
    return fields;
  }

  async meta(): Promise<Record<string, unknown>> {
    return record(await this.value('api/meta'));
  }

  async outline(path: string) {
    const fields = await this.object('api/outline?path=' + encodeURIComponent(path));
    return { path: string(fields.path), symbols: decodeSymbols(fields.symbols) };
  }

  async lsp(path: string): Promise<{ state: string; server: string }> {
    // Go State uses only the extension, without resolvePath's containment check.
    const fields = record(
      await this.value('api/lsp/setup?path=' + encodeURIComponent('state' + extname(path))),
    );
    return {
      state: string(fields.state),
      server: fields.state === 'failed' ? string(fields.reason) : string(fields.server),
    };
  }

  /** Evict Go's render/LSP state for a path Bun changed. */
  async closeFile(path: string): Promise<void> {
    await this.value('api/close?' + new URLSearchParams({ path }).toString());
  }

  close(): void {
    this.controller.abort();
  }
}
