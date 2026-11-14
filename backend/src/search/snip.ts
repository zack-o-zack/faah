export interface Snippet {
  pre: string;
  mid: string;
  post: string;
}
export function snip(options: { line: Uint8Array; from: number; to: number }): Snippet {
  const line = Buffer.from(options.line),
    from = Math.min(line.length, Math.max(0, options.from)),
    to = Math.min(line.length, Math.max(from, options.to));
  const preBytes = line.subarray(0, from),
    midBytes = line.subarray(from, to),
    postBytes = line.subarray(to);
  let pre = preBytes.toString().replace(/^[ \t]+/, ''),
    mid = midBytes.toString(),
    post = postBytes.toString().replace(/[ \t]+$/, '');
  const preLen = Buffer.byteLength(pre),
    midLen = midBytes.length,
    postLen = Buffer.byteLength(post);
  if (preLen <= 32 && preLen + midLen + postLen <= 240) return { pre, mid, post };
  let preRunes = preLen;
  if (preRunes > 32) {
    const runes = Array.from(pre);
    preRunes = runes.length;
    if (preRunes > 32) {
      pre = '…' + runes.slice(-16).join('');
      preRunes = 17;
    }
  }
  let midRunes = midLen;
  if (midRunes > 240) {
    const runes = Array.from(mid);
    midRunes = runes.length;
    if (midRunes > 240) {
      mid = runes.slice(0, 240).join('') + '…';
      midRunes = 241;
    }
  } else if (preLen + midLen + postLen > 240) midRunes = Array.from(mid).length;
  const budget = 240 - preRunes - midRunes;
  if (budget > 0) {
    if (Buffer.byteLength(post) > budget && Array.from(post).length > budget)
      post = Array.from(post).slice(0, budget).join('') + '…';
  } else post = '';
  return { pre, mid, post: post.replace(/[ \t]+$/, '') };
}
