interface Edit {
  type: string;
  val: string;
}
interface ChangedRanges {
  old: Uint8Array;
  next: Uint8Array;
  oldBars: Set<number>;
  newBars: Set<number>;
}
export interface SyntaxPart {
  text: string;
  className: string;
}
function tokenize(str: string): string[] {
  return str.match(/\w+|\s+|[^\w\s]/g) || [];
}

function myersDiff(aTokens: string[], bTokens: string[]): Edit[] | null {
  const n = aTokens.length,
    m = bTokens.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return bTokens.map((t) => ({ type: 'add', val: t }));
  if (m === 0) return aTokens.map((t) => ({ type: 'del', val: t }));

  const max = n + m;
  if (max > 400) return null; // Avoid deep search on massive minified lines

  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(max - d, max + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1 + max] ?? 0) < (v[k + 1 + max] ?? 0))) {
        x = v[k + 1 + max] ?? 0;
      } else {
        x = (v[k - 1 + max] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && aTokens[x] === bTokens[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= n && y >= m) {
        const script: Edit[] = [];
        let curX = n,
          curY = m;
        for (let step = d; step > 0; step--) {
          const prevV = trace[step];
          if (!prevV) continue;
          const curK = curX - curY;
          const prevK =
            curK === -step ||
            (curK !== step && (prevV[curK - 1 + step] ?? 0) < (prevV[curK + 1 + step] ?? 0))
              ? curK + 1
              : curK - 1;
          const prevX = prevV[prevK + step] ?? 0;
          const prevY = prevX - prevK;

          while (curX > prevX && curY > prevY && aTokens[curX - 1] === bTokens[curY - 1]) {
            script.push({ type: 'eq', val: aTokens[curX - 1] ?? '' });
            curX--;
            curY--;
          }
          if (curX > prevX) {
            script.push({ type: 'del', val: aTokens[curX - 1] ?? '' });
            curX--;
          } else if (curY > prevY) {
            script.push({ type: 'add', val: bTokens[curY - 1] ?? '' });
            curY--;
          }
        }
        while (curX > 0 && curY > 0) {
          script.push({ type: 'eq', val: aTokens[curX - 1] ?? '' });
          curX--;
          curY--;
        }
        return script.reverse();
      }
    }
  }
  return null;
}

// Overlays intra-line character change spans onto Chroma syntax-highlighted HTML
// (`<i class=...>`) without breaking tag nesting.
export function changedRanges(oldText: string, newText: string): ChangedRanges {
  const old = new Uint8Array(oldText.length);
  const next = new Uint8Array(newText.length);
  const oldBars = new Set<number>();
  const newBars = new Set<number>();
  if (oldText === newText) return { old, next, oldBars, newBars };
  const script = myersDiff(tokenize(oldText), tokenize(newText)) || [
    { type: 'del', val: oldText },
    { type: 'add', val: newText },
  ];
  let i = 0;
  let a = 0;
  let b = 0;
  while (i < script.length) {
    if (script[i]?.type === 'eq') {
      a += script[i]?.val.length ?? 0;
      b += script[i++]?.val.length ?? 0;
      continue;
    }
    let del = '';
    let add = '';
    while (i < script.length && script[i]?.type === 'del') del += script[i++]?.val ?? '';
    while (i < script.length && script[i]?.type === 'add') add += script[i++]?.val ?? '';
    let start = 0;
    while (start < del.length && start < add.length && del[start] === add[start]) start++;
    let aEnd = del.length;
    let bEnd = add.length;
    while (aEnd > start && bEnd > start && del[aEnd - 1] === add[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    old.fill(1, a + start, a + aEnd);
    next.fill(1, b + start, b + bEnd);
    if (aEnd === start && bEnd > start) oldBars.add(a + start);
    if (bEnd === start && aEnd > start) newBars.add(b + start);
    a += del.length;
    b += add.length;
  }
  return { old, next, oldBars, newBars };
}

function decode(text: string): string {
  const names: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'",
    nbsp: '\u00a0',
  };
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, entity) => {
    if (entity in names) return names[entity] ?? match;
    const number = entity.startsWith('#x')
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10);
    return entity.startsWith('#') && number >= 0 && number <= 0x10ffff
      ? String.fromCodePoint(number)
      : match;
  });
}

// Chroma's small <i class="token"> vocabulary becomes values for JSX, never injected HTML.
export function syntaxParts(
  text: string,
  html = '',
  mask?: Uint8Array,
  bars: Set<number> = new Set(),
  kind = '',
): SyntaxPart[] {
  const tokens = [];
  let token = '';
  for (const part of html.match(/<[^>]*>|[^<]+/g) || []) {
    if (part[0] === '<') {
      const match = /^<i\s+class=(?:"([\w -]+)"|'([\w -]+)'|([\w-]+))\s*>$/i.exec(part);
      token = match?.[1] || match?.[2] || match?.[3] || '';
    } else tokens.push({ text: decode(part), token });
  }
  if (tokens.map((part) => part.text).join('') !== text)
    tokens.splice(0, tokens.length, { text, token: '' });
  const output: SyntaxPart[] = [];
  let at = 0;
  for (const part of tokens) {
    for (const char of part.text) {
      if (bars.has(at)) output.push({ text: '', className: `diff-char-bar-${kind}` });
      const className = [
        part.token,
        mask?.[at] || (char.length === 2 && mask?.[at + 1]) ? `diff-char-${kind}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const last = output[output.length - 1];
      if (last?.className === className && last.text) last.text += char;
      else output.push({ text: char, className });
      at += char.length;
    }
  }
  if (bars.has(at)) output.push({ text: '', className: `diff-char-bar-${kind}` });
  return output;
}
