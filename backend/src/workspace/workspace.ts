import { join } from 'node:path';
import { FileMutations } from '../files/mutations.ts';
import { fileRoutes } from '../files/routes.ts';
import { Files } from '../files/view.ts';
import { FuzzyPool } from '../fuzzy/pool.ts';
import { GitActions } from '../git/actions.ts';
import { primeGitCache } from '../git/cache.ts';
import { GitCommands } from '../git/commands.ts';
import { GitReads } from '../git/reads.ts';
import { gitActionRoutes, gitReadRoutes } from '../git/routes.ts';
import { GitStatus } from '../git/status.ts';
import { GitWorkspace } from '../git/workspace.ts';
import type { RouteDef } from '../http/routes.ts';
import { WorkspaceStreams } from '../http/workspace-streams.ts';
import { IndexQueries } from '../index/queries.ts';
import { indexRoutes } from '../index/routes.ts';
import { Index } from '../index/service.ts';
import type { Child } from '../legacy/child.ts';
import { LegacyClient } from '../legacy/client.ts';
import { LegacyConsistency } from '../legacy/consistency.ts';
import { LegacyFiles } from '../legacy/files.ts';
import { legacyProxyRoutes } from '../legacy/proxy.ts';
import { MetricsCollector } from '../metrics/service.ts';
import { workspaceMetrics } from '../metrics/workspace.ts';
import { IdleScavenger } from '../render/idle.ts';
import { RenderService } from '../render/service.ts';
import { searchRoutes } from '../search/routes.ts';
import { Search } from '../search/service.ts';
import { SymbolLookup } from '../symbols/lookup.ts';
import { symbolRoutes } from '../symbols/routes.ts';
import { WorkspaceWatch, ignoreEvent } from '../watch/service.ts';
import { WorkspaceMeta } from './meta.ts';
import { workspaceRoutes } from './routes.ts';

export interface WorkspaceOptions {
  root: string;
  base: string;
  version: string;
  /** Workbench URL for a child workspace, or '' when standalone. */
  workbench: string;
  gitEnabled: boolean;
  /** The hidden Go server for routes Bun does not own yet. */
  legacy: Child;
}

/**
 * The composition root of one workspace process: it builds every service with
 * its dependencies, exposes their routes and shuts them down in order. It holds
 * no behaviour of its own beyond wiring the cross-service reactions (a file
 * change invalidates rendering, the index and Git).
 */
export class Workspace {
  readonly routes: readonly RouteDef[];
  readonly built: Promise<void>;
  private readonly commands: GitCommands;
  private readonly render = new RenderService();
  private readonly fuzzy = new FuzzyPool();
  private readonly idle: IdleScavenger;
  private readonly index: Index;
  private readonly git: GitWorkspace;
  private readonly legacy: LegacyClient;
  private readonly streams: WorkspaceStreams;
  private readonly watcher: WorkspaceWatch;
  private readonly mutations: FileMutations;

  constructor(private readonly options: WorkspaceOptions) {
    const { root, base, legacy: child } = options;
    this.commands = new GitCommands(undefined, options.gitEnabled);
    this.render.pool.prepare();
    this.idle = new IdleScavenger(() => {
      this.render.scavenge();
    });
    this.legacy = new LegacyClient(child.origin, base);
    this.index = this.createIndex();
    this.git = new GitWorkspace(this.index, this.commands);
    const reads = new GitReads(root, this.commands, this.render);
    const actions = new GitActions(this.git, (path) => this.afterGitChange(path));
    const metrics = new MetricsCollector();
    this.streams = new WorkspaceStreams(this.git, child.origin, base, () =>
      workspaceMetrics({
        collector: metrics,
        child,
        base,
        lspEnabled: false,
        extraPids: this.helperPids(),
      }),
    );
    const search = new Search({
      root,
      files: () => this.index.files,
      excluded: () =>
        [...this.index.children.values()].flatMap((nodes) => nodes.filter((node) => node.ignored)),
    });
    const legacyFiles = new LegacyFiles(
      this.legacy,
      async (query) => {
        await this.git.ensure();
        return reads.diffAvailable(query, this.index.git);
      },
      () => this.refreshGit(),
    );
    const files = new Files(root, this.render, legacyFiles);
    this.mutations = new FileMutations({
      root,
      render: this.render,
      legacy: legacyFiles,
      touch: (path) => this.index.touch(path),
    });
    this.watcher = this.createWatcher();
    const meta = new WorkspaceMeta({
      index: this.index,
      git: this.git,
      legacy: this.legacy,
      metrics,
      pids: () => [...(child.process.pid ? [child.process.pid] : []), ...this.helperPids()],
      version: options.version,
      base,
      workbench: options.workbench,
      rebuild: () => this.rebuildEverywhere(),
    });
    const consistency = new LegacyConsistency({
      refreshGit: () => this.refreshGit(),
      rebuildIndex: () => this.index.build(),
      touch: (path) => this.index.touch(path),
      refreshMeta: async () => {
        await this.legacy.meta();
      },
    });
    this.built = this.start();
    this.routes = [
      ...workspaceRoutes(meta, this.streams),
      ...gitReadRoutes(reads),
      ...gitActionRoutes(actions),
      ...fileRoutes({ root, files, mutations: this.mutations }),
      ...indexRoutes(
        new IndexQueries({
          index: this.index,
          fuzzy: this.fuzzy,
          git: this.git,
          built: this.built,
        }),
      ),
      ...searchRoutes(search),
      ...symbolRoutes(new SymbolLookup({ root, search, legacy: this.legacy })),
      ...legacyProxyRoutes(child.origin, consistency),
    ];
  }

  /** Every request except streams and metrics counts as activity for idle cache trimming. */
  onRequest(route: string, request: Request): void {
    this.idle.request(route, request.headers.get('accept'));
  }

  /** Process ids of helpers this workspace started, for memory metrics. */
  helperPids(): number[] {
    return this.watcher.pid ? [this.watcher.pid] : [];
  }

  async close(): Promise<void> {
    this.idle.close();
    await this.streams.close();
    await this.watcher.close();
    this.legacy.close();
    await this.git.close();
    await this.built.catch(() => undefined);
    this.fuzzy.close();
    await this.commands.processes.close();
    await this.render.close();
  }

  private createIndex(): Index {
    const { root, gitEnabled } = this.options;
    const primed = gitEnabled ? primeGitCache(root, this.commands.processes) : Promise.resolve();
    return new Index({
      root,
      gitState: async () => {
        await primed;
        return new GitStatus(this.commands.probe).read(root);
      },
      updated: async (items) => {
        await this.fuzzy.set(items);
        // A rebuild or TouchPath can publish a newer index than the Git cache.
        this.git.invalidate();
      },
    });
  }

  private createWatcher(): WorkspaceWatch {
    const { root } = this.options;
    return new WorkspaceWatch({
      root,
      gitDirectory: async () => (await this.commands.probe.get(root))?.dir,
      availability: (available) => {
        this.git.watching(available);
      },
      ignored: () => this.git.changed(),
      changed: async (paths, metadata) => {
        const rebuild = paths.some(ignoreEvent);
        for (const path of paths) {
          this.render.invalidate(join(root, path));
          if (!rebuild) await this.index.touch(path);
        }
        if (rebuild) await this.index.build();
        await this.git.changed(metadata);
      },
    });
  }

  /** Build the index, then warm rendering, start watching and publish Git state. */
  private async start(): Promise<void> {
    const started = this.index.build().then(async () => {
      void this.render
        .warm(this.index.files.map((file) => file.path))
        .catch((error: unknown) =>
          process.stderr.write('faah render warm: ' + String(error) + '\n'),
        );
      await this.watcher.start();
      await this.git.changed(true);
    });
    void started.catch((error: unknown) => {
      process.stderr.write('faah index: ' + String(error) + '\n');
    });
    return started;
  }

  private async refreshGit(): Promise<void> {
    await this.git.refresh();
  }

  /** Rebuild Go's index too, so both processes agree on the file set. */
  private async rebuildEverywhere(): Promise<void> {
    await this.legacy.value('api/reindex');
    await this.index.build();
  }

  /** A Git mutation changed one path (hunk discard) or possibly the whole tree (pull, abort). */
  private async afterGitChange(path?: string): Promise<void> {
    const { root } = this.options;
    if (path) {
      await this.mutations.changed(join(root, path), path);
      return;
    }
    for (const file of this.index.files) this.render.invalidate(join(root, file.path));
    await this.rebuildEverywhere();
  }
}
