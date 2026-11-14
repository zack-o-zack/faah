import { basename } from 'node:path';
import type { GitWorkspace } from '../git/workspace.ts';
import type { Index } from '../index/service.ts';
import type { LegacyClient } from '../legacy/client.ts';
import { decodeMetrics } from '../metrics/decode.ts';
import type { MetricsCollector } from '../metrics/service.ts';

export interface MetaOptions {
  index: Index;
  git: GitWorkspace;
  legacy: LegacyClient;
  metrics: MetricsCollector;
  /** Processes counted in this workspace's memory: the Go child and the watcher helper. */
  pids: () => number[];
  version: string;
  base: string;
  workbench: string;
  /** Rebuild the index in both processes. */
  rebuild: () => Promise<void>;
}

/**
 * `/api/meta` and `/api/reindex`. Go still reports its own capabilities (LSP,
 * agents, threads, forge); Bun overlays everything it owns: index, Git, version,
 * base path and process metrics.
 */
export class WorkspaceMeta {
  constructor(private readonly options: MetaOptions) {}

  async meta(): Promise<Record<string, unknown>> {
    const { index, git, legacy, version, base, workbench } = this.options;
    await git.ensure();
    const legacyMeta = await legacy.meta();
    const legacyMetrics = decodeMetrics(legacyMeta.metrics);
    const metrics = await this.options.metrics.collect(
      this.options.pids(),
      legacyMetrics.lspEnabled,
    );
    metrics.lspMemBytes = legacyMetrics.lspMemBytes;
    return {
      ...legacyMeta,
      metrics,
      root: index.root,
      name: basename(index.root),
      files: index.files.length,
      indexMs: index.indexMs,
      builtAt: index.builtAt,
      ready: index.ready,
      git: index.git.git,
      gitChanges: index.gitFiles.length,
      gitFiles: index.gitFiles,
      version,
      basePath: base,
      workbench,
    };
  }

  async reindex(): Promise<Record<string, unknown>> {
    const { index, git } = this.options;
    await this.options.rebuild();
    await git.refresh();
    return {
      files: index.files.length,
      indexMs: index.indexMs,
      gitChanges: index.gitFiles.length,
      gitFiles: index.gitFiles,
    };
  }
}
