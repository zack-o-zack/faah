import { goString } from './text.ts';
import { language, filenameLanguage } from './language.ts';
import { plain, visualWidth } from './html.ts';
import { RenderCancelled } from './cancel.ts';
export const chunkLines = 1000,
  windowBytes = 512 << 10,
  backgroundBytes = 2 << 20;
export function sizeOfLines(lines: readonly string[]): number {
  return lines.reduce((n, l) => n + Buffer.byteLength(l), lines.length * 16);
}
export type Highlight = (source: string, lang: string, want: number) => Promise<string[]>;
export class Document {
  readonly lang: string;
  readonly total: number;
  readonly maxCols: number;
  readonly offsets: Uint32Array;
  readonly initialBytes: number;
  private readonly source: Buffer;
  private chunks = new Map<number, string[]>();
  private pending = new Map<number, Promise<{ lines: string[]; exact: boolean }>>();
  private full = false;
  private background: Promise<void> | undefined;
  private scheduled = false;
  constructor(
    source: string | Uint8Array,
    path: string,
    readonly highlight: Highlight,
    readonly grow: (delta: number) => void = () => {},
    readonly observeBackground: (task: Promise<void>) => void = () => {},
  ) {
    this.source = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source);
    this.lang = filenameLanguage(path) ?? language(path, goString(this.source.subarray(0, 4096)));
    let total = 1;
    for (let i = 0; i < this.source.length; i++) if (this.source[i] === 10) total++;
    this.total = total;
    this.offsets = new Uint32Array(total + 1);
    let offset = 0,
      width = 0;
    for (let i = 0; i < total; i++) {
      this.offsets[i] = offset;
      const newline = this.source.indexOf(10, offset),
        end = newline < 0 ? this.source.length : newline;
      // Each byte contributes at most four columns, including tabs and invalid UTF-8.
      // Once a line cannot exceed the known width, its contents need no width scan.
      if (width < 20000 && (end - offset) * 4 > width) {
        let columns = 0;
        for (let p = offset; p < end; p++) {
          const byte = this.source[p] ?? 0;
          if (byte >= 128) {
            columns = visualWidth(goString(this.source.subarray(p, end)), columns);
            break;
          }
          columns += byte === 9 ? 4 - (columns % 4) : 1;
        }
        width = Math.max(width, columns);
      }
      offset = newline < 0 ? this.source.length : end + 1;
    }
    this.offsets[total] = this.source.length;
    this.maxCols = Math.min(width, 20000);
    this.initialBytes = this.source.length + total * 32;
  }
  raw(line: number): string {
    if (line < 1 || line > this.total) return '';
    const start = this.offsets[line - 1] ?? 0;
    let end = this.offsets[line] ?? this.source.length;
    if (end > start && this.source[end - 1] === 10) end--;
    return goString(this.source.subarray(start, end));
  }
  get coming(): boolean {
    return this.source.length <= backgroundBytes;
  }
  get exact(): boolean {
    return this.full;
  }
  async lines(start: number, end: number): Promise<{ lines: string[]; exact: boolean }> {
    if (this.full && start === 0 && end === this.total && this.total <= chunkLines)
      return { lines: (this.chunks.get(0) ?? []).slice(), exact: true };
    start = Math.max(0, start);
    end = Math.min(this.total, end);
    const schedule = () => {
      if (this.total > chunkLines && this.coming && !this.scheduled) {
        this.scheduled = true;
        this.background = new Promise<void>((resolve, reject) =>
          setTimeout(() => {
            void this.fullPass().then(resolve, reject);
          }, 0),
        ).catch((error: unknown) => {
          if (!(error instanceof RenderCancelled)) throw error;
        });
        this.observeBackground(this.background);
        void this.background.catch((error) =>
          process.stderr.write('faah render full pass: ' + String(error) + '\n'),
        );
      }
    };
    if (start >= end) {
      schedule();
      return { lines: [], exact: true };
    }
    const lines: string[] = [];
    let exact = true;
    for (let c = Math.floor(start / chunkLines); c * chunkLines < end; c++) {
      const result = await this.chunk(c);
      exact = exact && result.exact;
      lines.push(
        ...result.lines.slice(
          Math.max(0, start - c * chunkLines),
          Math.min(result.lines.length, end - c * chunkLines),
        ),
      );
    }
    schedule();
    return { lines, exact };
  }
  async settled(): Promise<void> {
    await this.background;
  }
  private chunk(c: number): Promise<{ lines: string[]; exact: boolean }> {
    const cached = this.chunks.get(c);
    if (cached) return Promise.resolve({ lines: cached, exact: this.full });
    let task = this.pending.get(c);
    if (!task) {
      task = this.renderChunk(c).finally(() => this.pending.delete(c));
      this.pending.set(c, task);
    }
    return task;
  }
  private async renderChunk(c: number): Promise<{ lines: string[]; exact: boolean }> {
    const start = c * chunkLines,
      end = Math.min(start + chunkLines, this.total);
    let from = Math.max(0, start - 400),
      to = Math.min(this.total, end + 400);
    if ((this.offsets[to] ?? 0) - (this.offsets[from] ?? 0) > windowBytes) {
      from = start;
      to = end;
    }
    // TextMate tokenizes forward one line at a time. Later context cannot change
    // an earlier line. Keep the source context for grammar loading and byte budgets,
    // but only ask the engine to tokenize through the end of this chunk.
    const segment = this.source.subarray(
      this.offsets[from] ?? 0,
      this.offsets[to] ?? this.source.length,
    );
    const all =
      segment.length > windowBytes
        ? plain(goString(segment), to - from)
        : await this.highlight(goString(segment), this.lang, end - from);
    if (this.full) return { lines: this.chunks.get(c) ?? [], exact: true };
    const lines = all.slice(start - from, end - from);
    if (c === 0 && this.total <= chunkLines && segment.length <= windowBytes) this.full = true;
    if (!this.chunks.has(c)) this.grow(sizeOfLines(lines));
    this.chunks.set(c, lines);
    return { lines, exact: this.full };
  }
  private async fullPass(): Promise<void> {
    const all = await this.highlight(goString(this.source), this.lang, this.total);
    const before = [...this.chunks.values()].reduce((n, v) => n + sizeOfLines(v), 0);
    let after = 0;
    for (let c = 0; c * chunkLines < this.total; c++) {
      const lines = all.slice(c * chunkLines, Math.min((c + 1) * chunkLines, this.total));
      this.chunks.set(c, lines);
      after += sizeOfLines(lines);
    }
    this.full = true;
    this.grow(after - before);
  }
}
