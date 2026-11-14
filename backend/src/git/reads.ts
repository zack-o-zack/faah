import { resolveFile } from '../files/service.ts';
import { highlightDiff } from '../render/diff.ts';
import type { RenderService } from '../render/service.ts';
import { GitCommands, validSHA } from './commands.ts';
import { GitHistory } from './history.ts';
import { GitDiff } from './diff.ts';
import { GitLinks } from './links.ts';
import { GitSync } from './sync.ts';
import { parseGutter } from './gutter.ts';
import type { GitState } from '../index/types.ts';

export class GitReads {
  private readonly history: GitHistory;
  private readonly diffs: GitDiff;
  private readonly links: GitLinks;
  private readonly sync: GitSync;
  constructor(
    readonly root: string,
    readonly commands: GitCommands,
    readonly render: RenderService,
  ) {
    this.history = new GitHistory(commands);
    this.diffs = new GitDiff(commands);
    this.links = new GitLinks(commands);
    this.sync = new GitSync(commands);
  }
  async diffAvailable(query: URLSearchParams, state: GitState): Promise<boolean> {
    const path = query.get('path') ?? '',
      ref = query.get('ref') ?? '',
      base = query.get('base') ?? '';
    const { rel } = resolveFile(this.root, path);
    if (ref)
      return Boolean(
        base && validSHA(base) && validSHA(ref)
          ? await this.diffs.between(this.root, rel, base, ref)
          : await this.diffs.commit(this.root, rel, ref),
      );
    const status = state.statuses[rel];
    return state.git && Boolean(status && status !== 'U');
  }
  async fileDiff(options: { path: string; ref: string; base: string }) {
    const { abs, rel } = resolveFile(this.root, options.path);
    const { ref, base } = options;
    const diff = ref
      ? base && validSHA(base) && validSHA(ref)
        ? await this.diffs.between(this.root, rel, base, ref)
        : await this.diffs.commit(this.root, rel, ref)
      : await this.diffs.against(this.root, rel);
    const hunks = await highlightDiff(rel, diff, (source, lang, want) =>
      this.render.highlight(source, lang, want, abs),
    );
    return { path: rel, ...(ref ? { ref, base } : {}), diff, hunks, available: Boolean(diff) };
  }
  async gutter(path: string, ref: string) {
    const { rel } = resolveFile(this.root, path);
    const diff = ref
      ? await this.diffs.commit(this.root, rel, ref)
      : await this.diffs.against(this.root, rel);
    const gutter = parseGutter(diff);
    return {
      path: rel,
      available: Boolean(gutter.added.length || gutter.modified.length || gutter.deleted.length),
      ...gutter,
    };
  }
  async log(limit: number) {
    const branch = await this.sync.branch(this.root);
    return {
      commits: await this.history.recent(this.root, limit),
      commitsUrl: await this.links.commits(this.root, branch),
    };
  }
  async unpushed(limit: number) {
    const result = await this.history.unpushed(this.root, limit);
    return { available: Boolean(result.upstream && result.commits.length), ...result };
  }
  async files(sha: string) {
    return { sha, files: await this.history.files(this.root, sha) };
  }
  detail(sha: string) {
    return this.history.detail(this.root, sha);
  }
}
