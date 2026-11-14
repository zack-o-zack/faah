import { readdir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { IgnoreSet, readGitignore } from '../ignore/service.ts';
import { newItem, type Item } from '../fuzzy/score.ts';
import { compare } from '../text.ts';
import { walk, sortNodes, vcs } from './walk.ts';
import { mergeGit, applyFlags, gitFiles } from './git.ts';
import { emptyGit, type Node, type GitState } from './types.ts';
export class Index {
  files: Item[] = [];
  children = new Map<string, Node[]>();
  ready = false;
  builtAt = '0001-01-01T00:00:00Z';
  indexMs = 0;
  git: GitState = emptyGit();
  private building: Promise<void> | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private gitRevision = 0;
  private edit<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action);
    this.pending = result.catch(() => undefined);
    return result;
  }
  constructor(
    readonly options: {
      root: string;
      gitState: () => Promise<GitState>;
      updated: (items: Item[]) => Promise<unknown>;
    },
  ) {}
  get root(): string {
    return this.options.root;
  }
  get gitFiles(): string[] {
    return gitFiles(this.git);
  }
  build(): Promise<void> {
    if (this.building) return this.building;
    this.building = this.runBuild().finally(() => {
      this.building = undefined;
    });
    return this.building;
  }
  private async runBuild(): Promise<void> {
    const start = performance.now(),
      revision = this.gitRevision;
    const [result, state] = await Promise.all([
      walk({
        root: this.root,
        publish: (nodes) => {
          void this.edit(async () => {
            this.children.set(
              '',
              nodes.map((n) => ({ ...n })),
            );
          });
        },
      }),
      this.options.gitState(),
    ]);
    await this.edit(async () => {
      // A stream update received during the walk is newer than the build snapshot.
      const git = this.gitRevision === revision ? state : this.git;
      await mergeGit({ children: result.children, state: git, root: this.root, build: true });
      this.children = result.children;
      this.files = result.files;
      this.git = git;
      await this.options.updated(this.files);
      this.builtAt = new Date().toISOString();
      this.indexMs = Math.floor(performance.now() - start);
      this.ready = true;
    });
  }
  applyGit(state: GitState): Promise<void> {
    return this.edit(async () => {
      await mergeGit({ children: this.children, state, root: this.root, build: false });
      this.git = state;
      this.gitRevision++;
    });
  }
  async list(dir: string): Promise<Node[] | undefined> {
    const kids = this.children.get(dir);
    if (kids) return kids.map((n) => ({ ...n }));
    if (!dir || dir.includes('\\') || dir.split('/').some((s) => !s || s === '.' || s === '..'))
      return;
    let p = dir;
    while (p) {
      const parent = posix.dirname(p) === '.' ? '' : posix.dirname(p);
      const entries = this.children.get(parent);
      if (entries) {
        const node = entries.find((n) => n.name === p.slice(parent ? parent.length + 1 : 0));
        if (!node?.dir || !node.ignored) return;
        break;
      }
      p = parent;
    }
    if (!p) return;
    try {
      const ents = await readdir(join(this.root, dir), { withFileTypes: true });
      return sortNodes(
        ents
          .filter((e) => !e.isSymbolicLink())
          .map((e) => ({
            name: e.name,
            path: dir + '/' + e.name,
            dir: e.isDirectory(),
            size: 0,
            ignored: true,
          })),
      );
    } catch {
      return;
    }
  }
  async compact(dir: string, mode: string): Promise<Node[] | undefined> {
    const kids = await this.list(dir);
    if (!kids || !['all', 'changed', 'yours'].includes(mode)) return kids;
    const keep = (n: Node) =>
      mode === 'all' || (mode === 'changed' ? n.dirty || n.status : n.yourDirty || n.yourStatus);
    for (let i = 0; i < kids.length; i++) {
      const initial = kids[i];
      if (!initial?.dir || initial.ignored) continue;
      let node: Node = initial;
      let name = node.name;
      while (true) {
        const next: Node[] | undefined = (await this.list(node.path))?.filter(keep);
        const only: Node | undefined = next?.[0];
        if (next?.length !== 1 || !only?.dir || only.ignored) break;
        name += '/' + only.name;
        node = only;
      }
      kids[i] = { ...node, name };
    }
    return kids;
  }
  async touch(path: string): Promise<void> {
    if (!this.ready) {
      await this.build();
      return;
    }
    await this.edit(() => this.touchReady(path));
  }
  private async touchReady(path: string): Promise<void> {
    const rel = path.replace(/^\/+|\/+$/g, '');
    if (!rel || rel.includes('..')) return;
    let info;
    try {
      info = await stat(join(this.root, rel));
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') return;
      this.files = this.files.filter((f) => f.path !== rel);
      const parent = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);
      this.children.set(
        parent,
        (this.children.get(parent) ?? []).filter((n) => n.path !== rel),
      );
      this.children.delete(rel);
      await this.options.updated(this.files);
      return;
    }
    let ignore = new IgnoreSet().child(await readGitignore(this.root, ''));
    const parts = rel.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const sub = parts.slice(0, i + 1).join('/');
      if (vcs.has(parts[i] ?? '') || ignore.match(sub, true)) return;
      ignore = ignore.child(await readGitignore(join(this.root, sub), sub));
    }
    const dir = info.isDirectory(),
      name = parts.at(-1) ?? '';
    if (dir && vcs.has(name)) return;
    const ignored = ignore.match(rel, dir);
    for (let i = 0; i < parts.length - 1; i++) {
      const parent = parts.slice(0, i).join('/'),
        sub = parts.slice(0, i + 1).join('/');
      const kids = this.children.get(parent) ?? [];
      if (!kids.some((n) => n.dir && n.path === sub)) {
        kids.push({ name: parts[i] ?? '', path: sub, dir: true, size: 0 });
        this.children.set(parent, sortNodes(kids));
      }
      if (!this.children.has(sub)) this.children.set(sub, []);
    }
    const parent = parts.slice(0, -1).join('/'),
      kids = this.children.get(parent) ?? [];
    let node = kids.find((n) => n.path === rel);
    if (!node) {
      node = { name, path: rel, dir, size: dir ? 0 : info.size };
      if (!dir && !ignored) applyFlags(node, this.git);
      kids.push(node);
      this.children.set(parent, sortNodes(kids));
    } else {
      node.size = dir ? 0 : info.size;
      node.dir = dir;
    }
    if (ignored) node.ignored = true;
    else delete node.ignored;
    if (dir && !ignored) {
      if (!this.children.has(rel)) this.children.set(rel, []);
      return;
    }
    if (!dir && !ignored) {
      this.files = this.files.filter((f) => f.path !== rel);
      this.files.push(newItem(rel, info.size));
      this.files.sort((a, b) => compare(a.path, b.path));
      await this.options.updated(this.files);
    }
  }
}
