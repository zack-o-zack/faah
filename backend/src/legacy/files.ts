import { record, string } from '../decode.ts';
import type { LegacyClient } from './client.ts';

export interface FileMetadata {
  diffAvailable: boolean;
  lsp: { state: string; server: string; anyRunning: boolean; missing?: string };
  diagnostics: Record<string, unknown>[];
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('invalid legacy flag');
  return value;
}

/**
 * The migration boundary for Git and LSP fields of a file response. Rendering
 * never calls legacy `/api/file`: Bun reads and highlights the file while this
 * adapter asks Go for LSP state concurrently and Bun's Git for diff availability.
 */
export class LegacyFiles {
  private disabledLSP: Pick<FileMetadata, 'lsp' | 'diagnostics'> | undefined;

  constructor(
    private readonly client: LegacyClient,
    private readonly diffAvailable: (query: URLSearchParams) => Promise<boolean>,
    private readonly refreshGit: () => Promise<void>,
  ) {}

  /** Go's LSP manager decides whether an absolute path outside the workspace may be read. */
  async allow(path: string): Promise<void> {
    await this.client.object('api/lsp/diagnostics?' + new URLSearchParams({ path }).toString());
  }

  async metadata(query: URLSearchParams, missing = false): Promise<FileMetadata> {
    const path = query.get('path') ?? '',
      suffix = '?' + new URLSearchParams({ path }).toString();
    const diffQuery = new URLSearchParams(query);
    if (missing) diffQuery.delete('base');
    const diff = this.diffAvailable(diffQuery);
    if (this.disabledLSP) return { ...this.disabledLSP, diffAvailable: flag(await diff) };
    const [available, diagnostics, setup, servers] = await Promise.all([
      diff,
      this.client.object('api/lsp/diagnostics' + suffix),
      this.client.object('api/lsp/setup' + suffix),
      this.client.object('api/lsp/servers'),
    ]);
    if (!Array.isArray(diagnostics.diagnostics)) throw new Error('invalid legacy diagnostics');
    const lsp: FileMetadata['lsp'] = {
      state: string(diagnostics.state),
      server: string(diagnostics.server),
      anyRunning: flag(servers.anyRunning),
    };
    if (setup.enabled === true && setup.state === 'off' && !setup.server && setup.lang)
      lsp.missing = string(setup.lang);
    // A disabled-LSP reply cannot change for the child's lifetime.
    if (setup.enabled === false) this.disabledLSP = { lsp, diagnostics: [] };
    return {
      diffAvailable: flag(available),
      lsp,
      diagnostics: diagnostics.diagnostics.map(record),
    };
  }

  /** Tell Go a path changed so it drops cached render/LSP state, then refresh Git. */
  async changed(path: string): Promise<void> {
    await this.client.closeFile(path);
    await this.refreshGit();
  }
}
