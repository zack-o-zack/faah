import { suite, mutation, capture, type Context } from './harness.ts';
import { query, request } from './transport.ts';
import { join } from 'node:path';
const s = suite('git');
s.case('refresh', 'api/git/refresh');
for (const path of [
  'unstaged.txt',
  'partial.txt',
  'staged.txt',
  'deleted.txt',
  'rename-new.txt',
  'history.txt',
  'untracked.txt',
]) {
  s.case(`diff-${path}`, query('api/diff', { path }));
  s.case(`gutter-${path}`, query('api/gutter', { path }));
}
s.case('diff-ref', (f) => query('api/diff', { path: 'history.txt', ref: f.head }));
s.case('diff-base', (f) => query('api/diff', { path: 'history.txt', ref: f.head, base: f.first }));
s.case('gutter-ref', (f) => query('api/gutter', { path: 'history.txt', ref: f.head }));
s.case('log', 'api/git/log');
s.case('log-one', 'api/git/log?limit=1');
s.case('log-bad-limit', 'api/git/log?limit=51');
s.case('unpushed', 'api/unpushed');
s.case('commitfiles', (f) => query('api/commitfiles', { sha: f.head }));
s.case('commitfiles-initial', (f) => query('api/commitfiles', { sha: f.first }));
s.case('commitfiles-missing', 'api/commitfiles?sha=0000000000000000000000000000000000000000');
s.case('commitdetail', (f) => query('api/commitdetail', { sha: f.head }));
s.case('commitdetail-missing', 'api/commitdetail?sha=0000000000000000000000000000000000000000');
s.case('sync-state', 'api/git/sync-state');
for (const action of ['stage', 'unstage'])
  mutation('git', action, async (c) => {
    await capture(c, 'git', action, `api/git/${action}`, {
      method: 'POST',
      json: { path: action === 'stage' ? 'unstaged.txt' : 'partial.txt' },
    });
    await capture(
      c,
      'git',
      `${action}-diff`,
      query('api/diff', { path: action === 'stage' ? 'unstaged.txt' : 'partial.txt' }),
    );
  });
for (const action of ['stage', 'unstage', 'discard'])
  mutation('git', `hunk-${action}`, async (c) => {
    const path = action === 'unstage' ? 'staged.txt' : 'unstaged.txt';
    const hunk =
      action === 'unstage'
        ? '@@ -1 +1 @@\n-stage before\n+stage after'
        : '@@ -1 +1 @@\n-before\n+after';
    await capture(c, 'git', `hunk-${action}`, 'api/git/hunk', {
      method: 'POST',
      json: { path, hunk, action },
    });
    await capture(c, 'git', `hunk-${action}-refresh`, 'api/git/refresh');
    await capture(c, 'git', `hunk-${action}-file`, query('api/file', { path, raw: 1 }));
  });
mutation('git', 'commit', async (c) => {
  await capture(c, 'git', 'commit', 'api/git/commit', {
    method: 'POST',
    json: { message: 'Contract commit' },
  });
  await capture(c, 'git', 'commit-log', 'api/git/log');
  await capture(c, 'git', 'commit-unpushed', 'api/unpushed?limit=1');
  await capture(c, 'git', 'commit-sync', 'api/git/sync-state');
});
mutation('git', 'commit-auto-stage', async (c) => {
  c.f.git('reset', '-q', 'HEAD');
  await capture(c, 'git', 'commit-auto-stage', 'api/git/commit', {
    method: 'POST',
    json: { message: 'Auto stage commit' },
  });
  await capture(c, 'git', 'commit-auto-stage-refresh', 'api/git/refresh');
});
function clean(c: Context) {
  c.f.git('reset', '--hard', 'HEAD');
  c.f.git('clean', '-fd');
}
async function remoteCommit(c: Context, content: string) {
  const peer = join(c.f.temp, 'peer');
  c.f.git('clone', '-q', c.f.remote, peer);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(peer, 'history.txt'), content);
  c.f.git('-C', peer, 'add', 'history.txt');
  c.f.git('-C', peer, 'commit', '-qm', 'Remote update');
  c.f.git('-C', peer, 'push', '-q', 'origin', 'main');
}
mutation('git', 'push', async (c) => {
  clean(c);
  await c.f.write('history.txt', 'local pushed revision\n');
  c.f.git('add', '.');
  c.f.git('commit', '-qm', 'Local update');
  await capture(c, 'git', 'push-before', 'api/git/sync-state');
  await capture(c, 'git', 'push', 'api/git/push', { method: 'POST', json: { force: false } });
  await capture(c, 'git', 'push-after', 'api/git/sync-state');
});
mutation('git', 'pull', async (c) => {
  clean(c);
  await remoteCommit(c, 'remote revision\n');
  c.f.git('fetch', '-q');
  await capture(c, 'git', 'pull-before', 'api/git/sync-state?fetch=1');
  await capture(c, 'git', 'pull', 'api/git/pull', { method: 'POST' });
  await capture(c, 'git', 'pull-file', query('api/file', { path: 'history.txt', raw: 1 }));
  await capture(c, 'git', 'pull-after', 'api/git/sync-state');
});
mutation('git', 'pull-dirty', async (c) => {
  await capture(c, 'git', 'pull-dirty', 'api/git/pull', { method: 'POST' });
});
mutation('git', 'pull-diverged', async (c) => {
  clean(c);
  await remoteCommit(c, 'remote conflicting revision\n');
  await c.f.write('history.txt', 'local conflicting revision\n');
  c.f.git('add', '.');
  c.f.git('commit', '-qm', 'Local divergence');
  await capture(c, 'git', 'pull-diverged', 'api/git/pull', { method: 'POST' });
});
mutation('git', 'abort-none', async (c) => {
  await capture(c, 'git', 'abort-none', 'api/git/abort', { method: 'POST' });
});
for (const op of ['merge', 'rebase'])
  mutation('git', `abort-${op}`, async (c) => {
    clean(c);
    c.f.git('checkout', '-qb', 'conflict');
    await c.f.write('history.txt', 'conflict branch\n');
    c.f.git('add', '.');
    c.f.git('commit', '-qm', 'Conflict branch');
    c.f.git('checkout', '-q', 'main');
    await c.f.write('history.txt', 'main branch\n');
    c.f.git('add', '.');
    c.f.git('commit', '-qm', 'Main branch');
    let conflicted = false;
    try {
      c.f.git(op, 'conflict');
    } catch {
      conflicted = true;
    }
    if (!conflicted) throw new Error(`Expected ${op} conflict`);
    await capture(c, 'git', `abort-${op}-before`, 'api/git/sync-state');
    await capture(c, 'git', `abort-${op}`, 'api/git/abort', { method: 'POST' });
    await capture(c, 'git', `abort-${op}-after`, 'api/git/sync-state');
    await request(c.server.baseUrl, 'api/git/refresh');
  });
