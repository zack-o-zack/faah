import { trimSpace } from '../text.ts';
import { GitCommands, atoi, commitDiffArgs, validSHA } from './commands.ts';
import { repoKey } from './probe.ts';
import { NameStatusParser, splitFields } from './status-parser.ts';
import { recentCommit, unpushedCommit, NumstatParser } from './history-parser.ts';
import type {
  GitCommit,
  GitUnpushedCommit,
  CommitFile,
  CommitDetail,
  Numstat,
} from './history-parser.ts';
import { GitLinks } from './links.ts';

export class GitHistory {
  constructor(readonly commands: GitCommands) {}
  async recent(root: string, count = 5): Promise<GitCommit[]> {
    if (count <= 0) count = 5;
    const commits: GitCommit[] = [];
    const ok = await this.commands.records(
      root,
      ['log', '-n' + count, '--format=%h%x1f%s%x1f%an%x1f%cr%x1f%H'],
      (line) => {
        line = trimSpace(line);
        if (line) commits.push(recentCommit(line));
      },
      10,
    );
    return ok ? commits : [];
  }
  async range(root: string, range: string, limit = 100): Promise<GitUnpushedCommit[]> {
    if (limit <= 0 || limit > 200) limit = 100;
    const commits: GitUnpushedCommit[] = [];
    const ok = await this.commands.records(
      root,
      ['log', '-n' + limit, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr', range],
      (line) => {
        if (line) commits.push(unpushedCommit(line));
      },
      10,
    );
    return ok ? commits : [];
  }
  async upstream(root: string): Promise<string> {
    return trimSpace(
      await this.commands.text(
        root,
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        true,
      ),
    );
  }
  async unpushed(root: string, limit = 100) {
    const upstream = await this.upstream(root);
    return { upstream, commits: upstream ? await this.range(root, '@{u}..HEAD', limit) : [] };
  }
  async numstat(root: string, sha: string): Promise<Map<string, Numstat>> {
    const parser = new NumstatParser();
    const ok = await this.commands.records(
      root,
      ['show', '--numstat', '-z', '--format=', '-m', '--first-parent', '--no-color', sha],
      (field) => parser.record(field),
    );
    return ok ? parser.stats : new Map();
  }
  async files(root: string, sha: string): Promise<CommitFile[]> {
    const info = await this.commands.probe.get(root);
    if (!info || !validSHA(sha)) return [];
    const paths: { path: string; status: string; from?: string }[] = [];
    const parser = new NameStatusParser((file) => paths.push(file));
    const ok = await this.commands.records(
      root,
      ['diff-tree', '--name-status', '-z', ...commitDiffArgs, sha],
      (field) => parser.record(field),
    );
    if (!ok) return [];
    const stats = await this.numstat(root, sha),
      key = repoKey(info, root),
      files: CommitFile[] = [];
    let processed = 0;
    for (const file of paths) {
      if (++processed % 1024 === 0) await Bun.sleep(0);
      const path = key(file.path),
        stat = stats.get(file.path);
      if (path === undefined) continue;
      const from = file.from === undefined ? undefined : key(file.from);
      files.push({
        path,
        status: file.status,
        add: stat?.add ?? 0,
        del: stat?.del ?? 0,
        ...(stat?.binary ? { binary: true } : {}),
        ...(from ? { from } : {}),
      });
    }
    return files;
  }
  async stat(root: string, sha: string) {
    const stat = { files: 0, insertions: 0, deletions: 0 };
    if (!validSHA(sha)) return stat;
    const ok = await this.commands.records(
      root,
      ['diff-tree', '--numstat', ...commitDiffArgs, sha],
      (line) => {
        const fields = splitFields(line, '\t', 3);
        if (fields.length < 3) return;
        stat.files++;
        stat.insertions += atoi(fields[0] ?? '') ?? 0;
        stat.deletions += atoi(fields[1] ?? '') ?? 0;
      },
      10,
    );
    return ok ? stat : { files: 0, insertions: 0, deletions: 0 };
  }
  async detail(root: string, sha: string): Promise<CommitDetail | undefined> {
    if (!validSHA(sha)) return;
    const raw = await this.commands.text(
      root,
      ['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%cr%x1f%cI%x1f%s%x1f%B', sha],
      true,
    );
    const fields = splitFields(raw, '\x1f', 8);
    if (fields.length < 8) return;
    const detail: CommitDetail = {
      hash: fields[0] ?? '',
      short: fields[1] ?? '',
      author: fields[2] ?? '',
      email: fields[3] ?? '',
      date: fields[4] ?? '',
      dateIso: fields[5] ?? '',
      subject: fields[6] ?? '',
      message: (fields[7] ?? '').replace(/\n+$/, ''),
      ...(await this.stat(root, sha)),
    };
    const links = new GitLinks(this.commands);
    const author = await links.author(root, detail.email, detail.author),
      commit = await links.commit(root, detail.hash);
    if (author) detail.authorUrl = author;
    if (commit) detail.commitUrl = commit;
    return detail;
  }
}
