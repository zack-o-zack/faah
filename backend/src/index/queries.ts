import { ServiceError } from '../errors.ts';
import type { FuzzyPool } from '../fuzzy/pool.ts';
import type { GitWorkspace } from '../git/workspace.ts';
import type { Index } from './service.ts';

/**
 * Tree listings and fuzzy file search over the workspace index. Listings carry
 * Git overlays, so they wait for the current Git state first.
 */
export class IndexQueries {
  constructor(
    private readonly options: {
      index: Index;
      fuzzy: FuzzyPool;
      git: GitWorkspace;
      /** Settles when the first index build finished. */
      built: Promise<void>;
    },
  ) {}

  async tree(dirParam: string, compact: string) {
    const { index, git } = this.options;
    await git.ensure();
    const dir = dirParam.replace(/^\/+|\/+$/g, '');
    let children = await index.list(dir);
    // The first walk publishes the root early; give nested listings up to 300 ms.
    for (let attempt = 0; !children && !index.ready && attempt < 30; attempt++) {
      await Bun.sleep(10);
      children = await index.list(dir);
    }
    if (!children) throw new ServiceError('not-found', 'not indexed: ' + dir);
    return { dir, children: (await index.compact(dir, compact)) ?? children };
  }

  async find(query: string, requestedLimit: number) {
    const { index, fuzzy, built } = this.options;
    const limit = requestedLimit <= 0 || requestedLimit > 500 ? 100 : requestedLimit;
    if (!index.ready) await Promise.race([built, Bun.sleep(300)]);
    const results = await fuzzy.find(query, limit);
    return {
      results: results.map(({ path, name, pos }) => ({ path, name, pos })),
      indexing: !index.ready,
    };
  }
}
