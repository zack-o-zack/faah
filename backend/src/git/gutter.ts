import { atoi } from './commands.ts';

export class GutterParser {
  readonly added: number[] = [];
  readonly modified: number[] = [];
  readonly deleted: number[] = [];
  private newLine = 0;
  private inHunk = false;
  private dels = 0;
  private adds: number[] = [];
  private blockStart = 0;
  private flush(): void {
    if (this.dels && this.adds.length) this.modified.push(...this.adds);
    else if (this.adds.length) this.added.push(...this.adds);
    else if (this.dels) this.deleted.push(this.blockStart - 1);
    this.dels = 0;
    this.adds = [];
  }
  record(line: string): void {
    if (line.startsWith('@@')) {
      this.flush();
      this.inHunk = true;
      const plus = line.indexOf('+');
      this.newLine = plus < 0 ? 1 : (atoi(line.slice(plus + 1).split(/[, ]/, 1)[0] ?? '') ?? 1);
    } else if (!this.inHunk || line.startsWith('\\')) return;
    else if (line.startsWith('+')) {
      if (!this.dels && !this.adds.length) this.blockStart = this.newLine;
      this.adds.push(this.newLine++);
    } else if (line.startsWith('-')) {
      if (!this.dels && !this.adds.length) this.blockStart = this.newLine;
      this.dels++;
    } else {
      this.flush();
      this.newLine++;
    }
  }
  finish(): { added: number[]; modified: number[]; deleted: number[] } {
    this.flush();
    return { added: this.added, modified: this.modified, deleted: this.deleted };
  }
}
export function parseGutter(diff: string) {
  const parser = new GutterParser();
  for (const line of diff.split('\n')) parser.record(line);
  return parser.finish();
}
