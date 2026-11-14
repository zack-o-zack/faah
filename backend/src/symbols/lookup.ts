import { isAbsolute } from 'node:path';
import { ServiceError } from '../errors.ts';
import { fileError, resolveFile } from '../files/service.ts';
import type { LegacyClient } from '../legacy/client.ts';
import type { Search } from '../search/service.ts';
import { trimSpace } from '../compat/go-strings.ts';
import { outline } from './service.ts';

/**
 * Outlines and definition lookup. Relative outlines and the search-based
 * definition fallback run in Bun; absolute paths and LSP state still come from
 * the Go language-server manager until it moves.
 */
export class SymbolLookup {
  constructor(private readonly options: { root: string; search: Search; legacy: LegacyClient }) {}

  async outline(path: string) {
    // The Go LSP manager still owns permission to read absolute definition targets.
    if (isAbsolute(path)) return this.options.legacy.outline(path);
    const { abs, rel } = resolveFile(this.options.root, path);
    try {
      return { path: rel, symbols: await outline(abs, rel) };
    } catch (error) {
      throw new ServiceError('not-found', fileError(error, abs));
    }
  }

  async definitions(symbolParam: string, path: string, signal: AbortSignal) {
    const symbol = trimSpace(symbolParam);
    if (!symbol) throw new ServiceError('invalid', 'no symbol');
    return {
      ...(await this.options.search.definitions(symbol, signal)),
      lsp: await this.options.legacy.lsp(path),
    };
  }
}
