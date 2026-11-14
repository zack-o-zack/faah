import { LRU } from '../render/lru.ts';
import type { Highlight } from '../render/document.ts';
import { fileWindow } from './window.ts';
import { goString } from '../render/text.ts';
import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { PathError, fileError, resolveFile } from './service.ts';
import { RenderService } from '../render/service.ts';
import { language } from '../render/language.ts';
import { isMarkdown, renderMarkdown } from '../markdown/service.ts';
import { delimiter, renderTable, maxBytes } from '../table/service.ts';
import type { LegacyFiles } from '../legacy/files.ts';
export class Files {
  private readonly markdownHighlights = new LRU<Highlight>(128);
  private markdownHighlight(abs: string): Highlight {
    const cached = this.markdownHighlights.get(abs);
    if (cached) return cached;
    const highlight: Highlight = (source, lang, want) =>
      this.render.highlight(source, lang, want, abs);
    this.markdownHighlights.put(abs, highlight, 1);
    return highlight;
  }
  constructor(
    readonly root: string,
    readonly render: RenderService,
    readonly legacy: LegacyFiles,
  ) {}
  async resolve(path: string): Promise<{ abs: string; rel: string }> {
    if (isAbsolute(path)) {
      await this.legacy.allow(path);
      return { abs: normalize(path), rel: normalize(path) };
    }
    const result = resolveFile(this.root, path);
    return result;
  }
  async file(query: URLSearchParams): Promise<Record<string, unknown>> {
    const { abs, rel } = await this.resolve(query.get('path') ?? '');
    query = new URLSearchParams(query);
    query.set('path', rel);
    let info: Stats;
    try {
      info = await stat(abs);
    } catch (error) {
      const metadata = await this.legacy.metadata(query, true);
      const missing =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
      if (missing && metadata.diffAvailable)
        return {
          path: rel,
          lang: language(rel, ''),
          total: 0,
          maxCols: 0,
          start: 0,
          lines: [],
          size: 0,
          exact: true,
          refine: false,
          markdown: isMarkdown(rel),
          table: delimiter(rel) !== undefined,
          diffAvailable: true,
          deleted: true,
          lsp: metadata.lsp,
        };
      throw new PathError(404, fileError(error, abs).replace(/^open /, 'stat '));
    }
    return this.existing(query, abs, rel, info);
  }
  private async existing(
    query: URLSearchParams,
    abs: string,
    rel: string,
    info: Stats,
  ): Promise<Record<string, unknown>> {
    if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i.test(rel))
      return { path: rel, image: true, size: info.size };
    const document = this.render.open(abs, rel).catch((error: unknown) => {
      throw new PathError(415, fileError(error, abs));
    });
    const metadata = this.legacy.metadata(query);
    const own = document.then(async (doc) => {
      const { start, end } = fileWindow(doc.total, query.get('start'), query.get('count'));
      const result = await doc.lines(start, end);
      return {
        path: rel,
        lang: doc.lang,
        total: doc.total,
        maxCols: doc.maxCols,
        start,
        lines: result.lines,
        size: info.size,
        exact: result.exact,
        refine: !result.exact && doc.coming,
        markdown: isMarkdown(rel),
        table: delimiter(rel) !== undefined,
        ...(query.get('raw') === '1'
          ? { raw: result.lines.map((_, i) => doc.raw(start + i + 1)) }
          : {}),
      };
    });
    const [body, fields] = await Promise.all([own, metadata]);
    return { ...body, ...fields };
  }
  async markdown(path: string): Promise<{ path: string; html: string }> {
    const { abs, rel } = await this.resolve(path);
    if (!isMarkdown(rel)) throw new PathError(415, 'not a Markdown file');
    const info = await stat(abs).catch((error: unknown) => {
      throw new PathError(404, fileError(error, abs).replace(/^open /, 'stat '));
    });
    if (info.isDirectory()) throw new PathError(415, 'is a directory');
    if (info.size > 4 << 20) throw new PathError(413, 'too large to preview');
    const data = await Bun.file(abs)
      .bytes()
      .catch((error: unknown) => {
        throw new PathError(404, fileError(error, abs));
      });
    return {
      path: rel,
      html: await renderMarkdown(goString(data), this.markdownHighlight(abs)),
    };
  }
  async table(path: string) {
    const { abs, rel } = await this.resolve(path),
      fallback = delimiter(rel);
    if (!fallback) throw new PathError(415, 'not a CSV or TSV file');
    const info = await stat(abs).catch((error: unknown) => {
      throw new PathError(404, fileError(error, abs));
    });
    if (info.isDirectory()) throw new PathError(415, 'is a directory');
    const bytes = await Bun.file(abs)
      .slice(0, maxBytes)
      .bytes()
      .catch((error: unknown) => {
        throw new PathError(404, fileError(error, abs));
      });
    return renderTable(bytes, info.size, fallback);
  }
}
