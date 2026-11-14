import { WorkspaceWatch } from '../watch/service.ts';
import { IdleScavenger } from '../render/idle.ts';
import { RenderService } from '../render/service.ts';
import { Files } from '../files/view.ts';
import { FileMutations } from '../files/mutations.ts';
import { LegacyFiles } from '../legacy/files.ts';
import { basename, isAbsolute, join } from 'node:path';
import { PathError, resolveFile, fileError } from '../files/service.ts';
import { outline } from '../symbols/service.ts';
import { trimSpace } from '../text.ts';
import { MetricsCollector } from '../metrics/service.ts';
import { decodeMetrics } from '../metrics/decode.ts';
import { Index } from './service.ts';
import { FuzzyPool } from '../fuzzy/pool.ts';
import { Search } from '../search/service.ts';
import { searchProfiler } from '../search/profile.ts';
import { LegacyNavigation } from '../legacy/navigation.ts';
import type { Child } from '../legacy/child.ts';
export class Navigation {
  readonly watcher: WorkspaceWatch;
  readonly idle = new IdleScavenger(() => this.render.scavenge());
  readonly render = new RenderService();
  readonly files: Files;
  readonly fileMutations: FileMutations;
  readonly fuzzy = new FuzzyPool();
  private readonly metrics = new MetricsCollector();
  readonly index: Index;
  readonly search: Search;
  readonly legacy: LegacyNavigation;
  readonly building: Promise<void>;
  constructor(options: {
    child: Child;
    base: string;
    root: string;
    version: string;
    workbench: string;
  }) {
    this.legacy = new LegacyNavigation({
      origin: options.child.origin,
      base: options.base,
      apply: (state) => this.index.applyGit(state),
      rebuild: () => this.index.build(),
      touch: (path) => this.index.touch(path),
    });
    this.index = new Index({
      root: options.root,
      gitState: () => this.legacy.refresh(),
      updated: (items) => this.fuzzy.set(items),
    });
    this.search = new Search({
      root: options.root,
      files: () => this.index.files,
      profile: searchProfiler(),
      excluded: () =>
        [...this.index.children.values()].flatMap((kids) => kids.filter((n) => n.ignored)),
    });
    const legacyFiles = new LegacyFiles(
      this.legacy,
      () => this.index.git,
      () => this.index.ready,
    );
    this.files = new Files(options.root, this.render, legacyFiles);
    this.fileMutations = new FileMutations({
      root: options.root,
      render: this.render,
      legacy: legacyFiles,
      touch: (path) => this.index.touch(path),
    });
    this.options = options;
    this.watcher = new WorkspaceWatch({
      root: options.root,
      changed: async (paths) => {
        const refresh = this.legacy.refreshAndApply();
        const touch = (async () => {
          for (const path of paths) {
            this.render.invalidate(join(options.root, path));
            await this.index.touch(path);
          }
        })();
        await Promise.all([touch, refresh]);
      },
    });
    this.building = this.index.build().then(async () => {
      this.legacy.start();
      await this.watcher.start();
    });
    void this.building.catch((error) => {
      process.stderr.write('faah index: ' + String(error) + '\n');
    });
  }
  private readonly options: {
    child: Child;
    base: string;
    root: string;
    version: string;
    workbench: string;
  };
  async meta(): Promise<Record<string, unknown>> {
    const legacy = await this.legacy.meta();
    const oldMetrics = decodeMetrics(legacy.metrics);
    const metrics = await this.metrics.collect(
      this.options.child.process.pid ? [this.options.child.process.pid] : [],
      oldMetrics.lspEnabled,
    );
    metrics.lspMemBytes = oldMetrics.lspMemBytes;
    return {
      ...legacy,
      metrics,
      root: this.index.root,
      name: basename(this.index.root),
      files: this.index.files.length,
      indexMs: this.index.indexMs,
      builtAt: this.index.builtAt,
      ready: this.index.ready,
      git: this.index.git.git,
      gitChanges: this.index.gitFiles.length,
      gitFiles: this.index.gitFiles,
      version: this.options.version,
      basePath: this.options.base,
      workbench: this.options.workbench,
    };
  }
  async tree(options: { dir: string; compact: string }) {
    const dir = options.dir.replace(/^\/+|\/+$/g, '');
    let kids = await this.index.list(dir);
    if (!kids && !this.index.ready) {
      for (let i = 0; i < 30; i++) {
        await Bun.sleep(10);
        kids = await this.index.list(dir);
        if (kids || this.index.ready) break;
      }
    }
    if (!kids) throw new PathError(404, 'not indexed: ' + dir);
    return { dir, children: (await this.index.compact(dir, options.compact)) ?? kids };
  }
  async find(options: { query: string; limit: number }) {
    const limit = options.limit <= 0 || options.limit > 500 ? 100 : options.limit;
    if (!this.index.ready) await Promise.race([this.building, Bun.sleep(300)]);
    const results = await this.fuzzy.find(options.query, limit);
    return {
      results: results.map(({ path, name, pos }) => ({ path, name, pos })),
      indexing: !this.index.ready,
    };
  }
  async outline(path: string) {
    // The Go LSP manager still owns permission to read absolute definition targets.
    if (isAbsolute(path)) return this.legacy.outline(path);
    const { abs, rel } = resolveFile(this.index.root, path);
    try {
      return { path: rel, symbols: await outline(abs, rel) };
    } catch (error) {
      throw new PathError(404, fileError(error, abs));
    }
  }
  async definitions(options: { symbol: string; path: string }, signal: AbortSignal) {
    const symbol = trimSpace(options.symbol);
    if (!symbol) throw new PathError(400, 'no symbol');
    return {
      ...(await this.search.definitions(symbol, signal)),
      lsp: await this.legacy.lsp(options.path),
    };
  }
  async reindex(): Promise<Record<string, unknown>> {
    await this.legacy.value('api/reindex');
    await this.index.build();
    return {
      files: this.index.files.length,
      indexMs: this.index.indexMs,
      gitChanges: this.index.gitFiles.length,
      gitFiles: this.index.gitFiles,
    };
  }
  async close(): Promise<void> {
    this.idle.close();
    await this.watcher.close();
    await this.legacy.close();
    await this.building.catch(() => undefined);
    this.fuzzy.close();
    await this.render.close();
  }
}
