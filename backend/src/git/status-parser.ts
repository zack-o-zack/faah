import type { GitState } from '../index/types.ts';
import { dictionary } from './maps.ts';

export type PathKey = (path: string) => string | undefined;
export function splitFields(text: string, separator: string, count: number): string[] {
  const fields: string[] = [];
  let start = 0;
  while (fields.length < count - 1) {
    const end = text.indexOf(separator, start);
    if (end < 0) break;
    fields.push(text.slice(start, end));
    start = end + separator.length;
  }
  fields.push(text.slice(start));
  return fields;
}
export function mapXY(xy: string): string {
  const code = xy.length < 2 ? 'M' : xy[0] === '.' ? xy[1] : xy[0];
  return code === 'U' ? '!' : code && 'ADRC'.includes(code) ? code : 'M';
}
export class StatusParser {
  readonly state: GitState = {
    git: true,
    statuses: dictionary<string>(),
    staged: dictionary<boolean>(),
    partial: dictionary<boolean>(),
    yourStatuses: dictionary<string>(),
  };
  private original = false;
  constructor(private readonly key: PathKey) {}
  record(field: string): void {
    if (this.original) {
      this.original = false;
      return;
    }
    const type = field[0];
    if (type === '?') {
      const path = this.key(field.slice(2));
      if (path !== undefined) this.state.statuses[path] = 'U';
      return;
    }
    const count = type === '1' ? 9 : type === '2' ? 10 : type === 'u' ? 11 : 0;
    if (!count) return;
    this.original = type === '2';
    const fields = splitFields(field, ' ', count),
      raw = fields[count - 1],
      xy = fields[1] ?? '';
    if (fields.length !== count || raw === undefined) return;
    const path = this.key(raw);
    if (path === undefined) return;
    this.state.statuses[path] = type === 'u' ? '!' : mapXY(xy);
    if (type === 'u' || (xy.length === 2 && xy[0] !== '.')) this.state.staged[path] = true;
    if (type !== 'u' && xy.length === 2 && xy[0] !== '.' && xy[1] !== '.')
      this.state.partial[path] = true;
  }
}
export interface NameStatus {
  path: string;
  status: string;
  from?: string;
}
export class NameStatusParser {
  private status = '';
  private from: string | undefined;
  constructor(private readonly consume: (value: NameStatus) => void) {}
  record(value: string): void {
    if (!this.status) {
      this.status = value.slice(0, 1);
      return;
    }
    if ((this.status === 'R' || this.status === 'C') && this.from === undefined) {
      this.from = value;
      return;
    }
    this.consume({
      path: value,
      status: this.status,
      ...(this.from === undefined ? {} : { from: this.from }),
    });
    this.status = '';
    this.from = undefined;
  }
}
