import type { GitState } from '../index/types.ts';
import { record, string } from '../decode.ts';
import { PathError } from '../files/service.ts';
import type { LegacyNavigation } from './navigation.ts';
export interface FileMetadata {
  diffAvailable: boolean;
  lsp: { state: string; server: string; anyRunning: boolean; missing?: string };
  diagnostics: Record<string, unknown>[];
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('invalid legacy flag');
  return value;
}
// The migration boundary for git and LSP file fields. Rendering never calls
// legacy /api/file: only subsystem metadata is fetched, concurrently.
export class LegacyFiles {
  private disabledLSP: Pick<FileMetadata, 'lsp' | 'diagnostics'> | undefined;
  constructor(
    readonly navigation: LegacyNavigation,
    readonly git: () => GitState,
    readonly ready: () => boolean,
  ) {}
  private async object(route: string): Promise<Record<string, unknown>> {
    const response = await fetch(
      this.navigation.options.origin + this.navigation.options.base + route,
    );
    const value: unknown = await response.json(),
      v = record(value);
    if (!response.ok) throw new PathError(response.status, string(v.error));
    return v;
  }
  async allow(path: string): Promise<void> {
    await this.object('api/lsp/diagnostics?' + new URLSearchParams({ path }));
  }
  async metadata(query: URLSearchParams, missing = false): Promise<FileMetadata> {
    const path = query.get('path') ?? '',
      suffix = '?' + new URLSearchParams({ path });
    const diffQuery = new URLSearchParams(query);
    if (missing) diffQuery.delete('base');
    const state = this.git(),
      status = state.statuses[path];
    // Port of Index.HasDiffAvailable: normal workspace indexes use HEAD.
    // Explicit refs still ask Go, including the deleted-file base oddity.
    const diff =
      !query.get('ref') && this.ready()
        ? Promise.resolve({ available: state.git && Boolean(status && status !== 'U') })
        : this.object('api/diff?' + diffQuery);
    if (this.disabledLSP)
      return { ...this.disabledLSP, diffAvailable: boolean((await diff).available) };
    const [difference, diagnostics, setup, servers] = await Promise.all([
      diff,
      this.object('api/lsp/diagnostics' + suffix),
      this.object('api/lsp/setup' + suffix),
      this.object('api/lsp/servers'),
    ]);
    if (!Array.isArray(diagnostics.diagnostics)) throw new Error('invalid legacy diagnostics');
    const lsp: FileMetadata['lsp'] = {
      state: string(diagnostics.state),
      server: string(diagnostics.server),
      anyRunning: boolean(servers.anyRunning),
    };
    if (setup.enabled === true && setup.state === 'off' && !setup.server && setup.lang)
      lsp.missing = string(setup.lang);
    if (setup.enabled === false) this.disabledLSP = { lsp, diagnostics: [] };
    return {
      diffAvailable: boolean(difference.available),
      lsp,
      diagnostics: diagnostics.diagnostics.map(record),
    };
  }
  async changed(path: string): Promise<void> {
    await this.navigation.value('api/close?' + new URLSearchParams({ path }));
    await this.navigation.refreshAndApply();
  }
}
