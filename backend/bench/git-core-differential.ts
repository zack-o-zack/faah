import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fixture } from '../../test/contract/fixtures.ts';
import { launch } from '../../bench/launch.ts';
import { ready } from '../../bench/http.ts';
import { record, string } from '../src/decode.ts';
import { GitProcesses } from '../src/git/process.ts';
import { GitCommands } from '../src/git/commands.ts';
import { GitStatus } from '../src/git/status.ts';
import { GitHistory } from '../src/git/history.ts';
import { GitDiff } from '../src/git/diff.ts';
import { GitMutations } from '../src/git/mutations.ts';
import { GitLinks } from '../src/git/links.ts';
import { GitSync } from '../src/git/sync.ts';
import { parseGutter } from '../src/git/gutter.ts';
import { RenderService } from '../src/render/service.ts';
import { RenderDisk } from '../src/render/disk.ts';
import { highlightDiff } from '../src/render/diff.ts';
import { highlightedText } from '../../test/contract/highlight.ts';

const binary = process.env.FAAH_LEGACY_BIN;
if (!binary) throw new Error('Set FAAH_LEGACY_BIN to the Go reference');
const f = await fixture(),
  processes = new GitProcesses(4, ['git'], f.env);
const commands = new GitCommands(processes),
  status = new GitStatus(commands.probe);
const history = new GitHistory(commands),
  diff = new GitDiff(commands),
  mutations = new GitMutations(commands);
const sync = new GitSync(commands),
  links = new GitLinks(commands);
const render = new RenderService(new RenderDisk(join(f.temp, 'native-render.sqlite')));
const mismatches: { name: string; expected: unknown; actual: unknown }[] = [];
let cases = 0;
function plain(value: unknown): unknown {
  const decoded: unknown = JSON.parse(JSON.stringify(value));
  return decoded;
}
function equal(name: string, expected: unknown, actual: unknown): void {
  cases++;
  if (!isDeepStrictEqual(plain(expected), plain(actual)))
    mismatches.push({ name, expected, actual });
}
function hunks(value: unknown): unknown {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error('invalid hunks');
  return value.map((value) => {
    const hunk = record(value);
    if (!Array.isArray(hunk.rows)) throw new Error('invalid rows');
    return {
      ...hunk,
      rows: hunk.rows.map((value) => {
        const row = record(value);
        return row.html === undefined ? row : { ...row, html: highlightedText(string(row.html)) };
      }),
    };
  });
}
try {
  const server = await launch(binary, f.root);
  try {
    await ready(server.baseUrl, server.started);
    const get = async (route: string, params: Record<string, string> = {}) => {
      const url = new URL(route, server.baseUrl);
      url.search = new URLSearchParams(params).toString();
      return record(await (await fetch(url)).json());
    };
    const compareStatus = async (name: string) => {
      const expected = await get('api/git/refresh'),
        actual = await status.read(f.root);
      for (const key of ['statuses', 'staged', 'partial', 'yourStatuses'])
        equal(name + ':' + key, expected[key] ?? {}, record(actual)[key]);
    };
    await compareStatus('initial');
    const log = await get('api/git/log');
    equal('recent', log.commits, await history.recent(f.root));
    equal('commits-url', log.commitsUrl, await links.commits(f.root, await sync.branch(f.root)));
    const unpushed = await history.unpushed(f.root);
    equal('unpushed', await get('api/unpushed'), {
      ...unpushed,
      available: Boolean(unpushed.upstream && unpushed.commits.length),
    });
    for (const sha of [f.first, f.head, 'HEAD~1', 'deadbeef']) {
      equal(
        'files:' + sha,
        (await get('api/commitfiles', { sha })).files,
        await history.files(f.root, sha),
      );
      const detail = await history.detail(f.root, sha),
        expected = await get('api/commitdetail', { sha });
      equal(
        'detail:' + sha,
        detail === undefined ? 'unknown commit' : expected,
        detail === undefined ? expected.error : detail,
      );
    }
    for (const path of [
      'unstaged.txt',
      'partial.txt',
      'deleted.txt',
      'rename-new.txt',
      'untracked.txt',
      'src/hello.go',
    ]) {
      const expected = await get('api/diff', { path }),
        raw = await diff.against(f.root, path);
      equal('diff:' + path, expected.diff, raw);
      equal(
        'hunks:' + path,
        hunks(expected.hunks),
        hunks(
          await highlightDiff(path, raw, (source, lang, want) =>
            render.highlight(source, lang, want),
          ),
        ),
      );
      const gutter = parseGutter(raw);
      equal('gutter:' + path, await get('api/gutter', { path }), {
        path,
        ...gutter,
        available: Boolean(gutter.added.length || gutter.modified.length || gutter.deleted.length),
      });
    }
    for (const ref of [f.first, f.head, 'bad-ref']) {
      const path = 'history.txt',
        expected = await get('api/diff', { path, ref });
      equal('commit-diff:' + ref, expected.diff, await diff.commit(f.root, path, ref));
    }
    for (const remote of [
      'git@github.com:alice/repo.git',
      'https://user:token@GitHub.com:443/alice/a%20b.git',
      'https://github.com:99999/alice/repo.git',
      'https://[fe80::1%25eth0]/alice/repo.git',
      'https://github.com/alice/a/../repo.git',
      'https://%67ithub.com/alice/repo.git',
      'https:///alice/repo.git',
      'https://user name@github.com/alice/repo.git',
      'https://你好@github.com/alice/repo.git',
    ]) {
      f.git('remote', 'set-url', 'origin', remote);
      equal(
        'remote-detail:' + remote,
        await get('api/commitdetail', { sha: f.head }),
        await history.detail(f.root, f.head),
      );
    }
    await mutations.stage(f.root, 'partial.txt');
    await compareStatus('staged');
    await f.write('partial.txt', 'changed after staging\n');
    await compareStatus('partial');
    await mutations.unstage(f.root, 'partial.txt');
    await compareStatus('unstaged');
  } finally {
    await server.stop();
  }
  const result = { cases, mismatches };
  await Bun.write(
    process.env.FAAH_GIT_CORE_REPORT ?? '/tmp/faah-git-core-differential.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify({ cases, mismatches: mismatches.length }) + '\n');
  if (mismatches.length) throw new Error('Git core differs from the Go API');
} finally {
  await render.close();
  await processes.close();
  await f.cleanup();
}
