import { goString } from './go-utf8.ts';

// Go's json.Decoder as faah's handlers use it: one JSON value is read and any
// trailing input is ignored. Strings are decoded from raw bytes (latin1 text)
// so invalid UTF-8 is replaced per byte, and error messages use Go's wording.
// Object entries keep their order so differently cased duplicate keys still
// resolve last-value-wins, as Go's case-insensitive field matching does.

/** A decoded JSON object with its entries in source order, duplicates included. */
export class GoObject {
  constructor(readonly entries: [string, unknown][]) {}
}

/** Numeric source text for struct decoders that must distinguish 1, 1.0 and 1e0. */
export class GoNumber {
  constructor(readonly source: string) {}
}

class GoJSONReader {
  private pos = 0;
  constructor(
    readonly source: string,
    readonly preserveNumbers = false,
  ) {}

  private fail(message: string): never {
    throw new Error(message);
  }

  private character(character: string): string {
    return (
      "'" +
      character
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t') +
      "'"
    );
  }

  private invalid(context: string): never {
    const character = this.source[this.pos];
    if (character === undefined) return this.fail('unexpected EOF');
    return this.fail('invalid character ' + this.character(character) + ' ' + context);
  }

  private whitespace(): void {
    while (/[ \t\r\n]/.test(this.source[this.pos] ?? 'x')) this.pos++;
  }

  value(): unknown {
    this.whitespace();
    const character = this.source[this.pos];
    if (character === '"') return this.text();
    if (character === '{') return this.container(false);
    if (character === '[') return this.container(true);
    if (character === 't' || character === 'f' || character === 'n') {
      const word = character === 't' ? 'true' : character === 'f' ? 'false' : 'null';
      for (const expected of word) {
        if (this.source[this.pos] !== expected)
          this.invalid('in literal ' + word + ' (expecting ' + this.character(expected) + ')');
        this.pos++;
      }
      return word === 'true' ? true : word === 'false' ? false : null;
    }
    if (character === '-' || (character && /[0-9]/.test(character))) return this.numeric();
    return this.invalid('looking for beginning of value');
  }

  private text(): string {
    const start = this.pos++;
    while (this.pos < this.source.length) {
      const character = this.source[this.pos++] ?? '';
      if (character === '"') {
        const value: unknown = JSON.parse(
          goString(Buffer.from(this.source.slice(start, this.pos), 'latin1')),
        );
        if (typeof value !== 'string') throw new Error('invalid JSON string');
        return value.toWellFormed();
      }
      if (character.charCodeAt(0) < 32) {
        this.pos--;
        this.invalid('in string literal');
      }
      if (character === '\\') {
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

  private numeric(): number | GoNumber {
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
    const source = this.source.slice(start, this.pos);
    return this.preserveNumbers ? new GoNumber(source) : Number(source);
  }

  private container(array: boolean): unknown {
    this.pos++;
    this.whitespace();
    const end = array ? ']' : '}',
      entries: [string, unknown][] = [],
      values: unknown[] = [];
    if (this.source[this.pos] === end) {
      this.pos++;
      return array ? values : new GoObject(entries);
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
      const character = this.source[this.pos++];
      if (character === end) return array ? values : new GoObject(entries);
      if (character !== ',') {
        this.pos--;
        this.invalid(array ? 'after array element' : 'after object key:value pair');
      }
      this.whitespace();
    }
  }
}

/** The kind word Go's json errors use for a decoded value. */
export function goJSONKind(value: unknown): string {
  return value instanceof GoNumber
    ? 'number'
    : value instanceof GoObject
      ? 'object'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'boolean'
          ? 'bool'
          : typeof value;
}

/** Decode the first JSON value in `input`; throws Go's decoder messages (`unexpected EOF`, …). */
export function parseGoJSON(input: string | Uint8Array, preserveNumbers = false): unknown {
  const text =
    typeof input === 'string'
      ? Buffer.from(input).toString('latin1')
      : Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('latin1');
  if (/^[ \t\r\n]*$/.test(text)) throw new Error('EOF');
  return new GoJSONReader(text, preserveNumbers).value();
}
