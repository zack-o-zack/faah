import { goString } from '../render/text.ts';
import { PathError } from './service.ts';
// Go's handlers decode one JSON value, ignoring trailing input. Keep ordered
// object entries so differently cased duplicates still have last-value wins.
class OrderedObject {
  constructor(readonly entries: [string, unknown][]) {}
}
class JSONInput {
  private pos = 0;
  constructor(readonly source: string) {}
  private fail(message: string): never {
    throw new Error(message);
  }
  private character(c: string): string {
    return (
      "'" +
      c
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t') +
      "'"
    );
  }
  private invalid(context: string): never {
    const c = this.source[this.pos];
    if (c === undefined) return this.fail('unexpected EOF');
    return this.fail('invalid character ' + this.character(c) + ' ' + context);
  }
  private whitespace(): void {
    while (/[ \t\r\n]/.test(this.source[this.pos] ?? 'x')) this.pos++;
  }
  value(): unknown {
    this.whitespace();
    const c = this.source[this.pos];
    if (c === '"') return this.text();
    if (c === '{') return this.container(false);
    if (c === '[') return this.container(true);
    if (c === 't' || c === 'f' || c === 'n') {
      const word = c === 't' ? 'true' : c === 'f' ? 'false' : 'null';
      for (const expected of word) {
        if (this.source[this.pos] !== expected)
          this.invalid('in literal ' + word + ' (expecting ' + this.character(expected) + ')');
        this.pos++;
      }
      return word === 'true' ? true : word === 'false' ? false : null;
    }
    if (c === '-' || (c && /[0-9]/.test(c))) return this.numeric();
    return this.invalid('looking for beginning of value');
  }
  private text(): string {
    const start = this.pos++;
    while (this.pos < this.source.length) {
      const c = this.source[this.pos++] ?? '';
      if (c === '"') {
        const value: unknown = JSON.parse(
          goString(Buffer.from(this.source.slice(start, this.pos), 'latin1')),
        );
        if (typeof value !== 'string') throw new Error('invalid JSON string');
        return value.toWellFormed();
      }
      if (c.charCodeAt(0) < 32) {
        this.pos--;
        this.invalid('in string literal');
      }
      if (c === '\\') {
        const escape = this.source[this.pos];
        if (escape === 'u') {
          this.pos++;
          for (let i = 0; i < 4; i++) {
            if (!/[0-9a-fA-F]/.test(this.source[this.pos] ?? 'x'))
              this.invalid('in \\u hexadecimal character escape');
            this.pos++;
          }
        } else {
          if (!escape || !'"\\/bfnrt'.includes(escape)) this.invalid('in string escape code');
          this.pos++;
        }
      }
    }
    return this.fail('unexpected EOF');
  }
  private numeric(): number {
    const start = this.pos;
    if (this.source[this.pos] === '-') this.pos++;
    if (this.source[this.pos] === '0') this.pos++;
    else {
      if (!/[1-9]/.test(this.source[this.pos] ?? 'x')) this.invalid('in numeric literal');
      while (/[0-9]/.test(this.source[this.pos] ?? 'x')) this.pos++;
    }
    if (this.source[this.pos] === '.') {
      this.pos++;
      if (!/[0-9]/.test(this.source[this.pos] ?? 'x'))
        this.invalid('after decimal point in numeric literal');
      while (/[0-9]/.test(this.source[this.pos] ?? 'x')) this.pos++;
    }
    if (/[eE]/.test(this.source[this.pos] ?? 'x')) {
      this.pos++;
      if (/[+-]/.test(this.source[this.pos] ?? 'x')) this.pos++;
      if (!/[0-9]/.test(this.source[this.pos] ?? 'x'))
        this.invalid('in exponent of numeric literal');
      while (/[0-9]/.test(this.source[this.pos] ?? 'x')) this.pos++;
    }
    return Number(this.source.slice(start, this.pos));
  }
  private container(array: boolean): unknown {
    this.pos++;
    this.whitespace();
    const end = array ? ']' : '}',
      entries: [string, unknown][] = [],
      values: unknown[] = [];
    if (this.source[this.pos] === end) {
      this.pos++;
      return array ? values : new OrderedObject(entries);
    }
    while (true) {
      if (array) values.push(this.value());
      else {
        if (this.source[this.pos] !== '"')
          this.invalid('looking for beginning of object key string');
        const key = this.text();
        this.whitespace();
        if (this.source[this.pos] !== ':') this.invalid('after object key');
        this.pos++;
        entries.push([key, this.value()]);
      }
      this.whitespace();
      const c = this.source[this.pos++];
      if (c === end) return array ? values : new OrderedObject(entries);
      if (c !== ',') {
        this.pos--;
        this.invalid(array ? 'after array element' : 'after object key:value pair');
      }
      this.whitespace();
    }
  }
}
function kind(value: unknown): string {
  return value instanceof OrderedObject
    ? 'object'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'boolean'
        ? 'bool'
        : typeof value;
}
export function decodeFileInput(
  input: string | Uint8Array,
  save: boolean,
): { path: string; content: string; type: string } {
  const text =
    typeof input === 'string'
      ? Buffer.from(input).toString('latin1')
      : Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('latin1');
  const name = save ? 'fileSaveRequest' : 'fsNewRequest',
    out = { path: '', content: '', type: '' };
  try {
    if (/^[ \t\r\n]*$/.test(text)) throw new Error('EOF');
    const value = new JSONInput(text).value();
    if (value === null) return out;
    if (!(value instanceof OrderedObject))
      throw new Error(`json: cannot unmarshal ${kind(value)} into Go value of type main.${name}`);
    for (const [key, fieldValue] of value.entries) {
      const field = key.toLowerCase();
      if (field !== 'path' && field !== (save ? 'content' : 'type')) continue;
      if (fieldValue === null) continue;
      if (typeof fieldValue !== 'string')
        throw new Error(
          `json: cannot unmarshal ${kind(fieldValue)} into Go struct field ${name}.${key} of type string`,
        );
      if (field === 'path') out.path = fieldValue;
      else if (field === 'content') out.content = fieldValue;
      else out.type = fieldValue;
    }
    return out;
  } catch (error) {
    throw new PathError(
      400,
      'invalid json: ' + (error instanceof Error ? error.message : String(error)),
    );
  }
}

// Git handlers report a fixed missing-field error, but use the same ordered,
// single-value Go JSON decoding as file requests.
export function decodeStringFields(
  input: Uint8Array,
  fields: readonly string[],
): Record<string, string> {
  const value = new JSONInput(Buffer.from(input).toString('latin1')).value();
  const out: Record<string, string> = {};
  if (value === null) return out;
  if (!(value instanceof OrderedObject)) throw new Error('expected object');
  for (const [key, fieldValue] of value.entries) {
    const field = key.toLowerCase();
    if (!fields.includes(field) || fieldValue === null) continue;
    if (typeof fieldValue !== 'string') throw new Error('expected string');
    out[field] = fieldValue;
  }
  return out;
}
