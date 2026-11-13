import { mutation, capture } from './harness.ts';
import { query } from './transport.ts';
for (const [name, path, content] of [
  ['save-existing', 'unstaged.txt', 'saved 你好 😀\n'],
  ['save-parents', 'created/deep/new.txt', 'parent created\n'],
]) {
  if (!name || !path || content === undefined) throw new Error('Invalid case');
  mutation('mutations', name, async (c) => {
    await capture(c, 'mutations', name, 'api/file/save', {
      method: 'POST',
      json: { path, content },
    });
    await capture(c, 'mutations', `${name}-file`, query('api/file', { path, raw: 1 }));
    // Synchronize Git metadata before checking status-bearing tree nodes.
    const { request } = await import('./transport.ts');
    await request(c.server.baseUrl, 'api/git/refresh');
    await capture(
      c,
      'mutations',
      `${name}-tree`,
      query('api/tree', { dir: path.includes('/') ? 'created/deep' : '' }),
    );
  });
}
for (const [name, path, type] of [
  ['new-dir', 'newdir/deep', 'dir'],
  ['new-file', 'newfile/deep.txt', 'file'],
  ['existing', 'history.txt', 'file'],
]) {
  if (!name || !path || !type) throw new Error('Invalid case');
  mutation('mutations', name, async (c) => {
    await capture(c, 'mutations', name, 'api/fs/new', { method: 'POST', json: { path, type } });
    const { request } = await import('./transport.ts');
    await request(c.server.baseUrl, 'api/git/refresh');
    await capture(
      c,
      'mutations',
      `${name}-tree`,
      query('api/tree', {
        dir: type === 'dir' ? 'newdir' : path === 'history.txt' ? '' : 'newfile',
      }),
    );
    if (type !== 'dir')
      await capture(c, 'mutations', `${name}-file`, query('api/file', { path, raw: 1 }));
  });
}
