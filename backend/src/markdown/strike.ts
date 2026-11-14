import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
function finish(state: StateInline, delimiters: StateInline['delimiters']): void {
  for (let i = delimiters.length - 1; i >= 0; i--) {
    const open = delimiters[i];
    if (!open || open.marker !== 126 || open.end < 0) continue;
    const close = delimiters[open.end],
      previous = delimiters[i - 1],
      after = delimiters[open.end + 1];
    if (!close) continue;
    const paired =
      previous?.marker === 126 &&
      previous.end === open.end + 1 &&
      previous.token === open.token - 1 &&
      after?.token === close.token + 1;
    const left = state.tokens[open.token],
      right = state.tokens[close.token];
    if (!left || !right) continue;
    left.type = 's_open';
    left.tag = 'del';
    left.nesting = 1;
    left.content = '';
    left.markup = paired ? '~~' : '~';
    right.type = 's_close';
    right.tag = 'del';
    right.nesting = -1;
    right.content = '';
    right.markup = left.markup;
    if (paired && previous && after) {
      const before = state.tokens[previous.token],
        end = state.tokens[after.token];
      if (before) before.content = '';
      if (end) end.content = '';
      i--;
    }
  }
}
// Goldmark accepts one or two tildes and rejects longer runs. Retain the
// Markdown parser's flanking/balancing rules, then emit one del per pair.
export function goldmarkStrike(md: MarkdownIt): void {
  md.inline.ruler.at('strikethrough', (state, silent) => {
    if (silent || state.src[state.pos] !== '~' || state.src[state.pos - 1] === '~') return false;
    const scan = state.scanDelims(state.pos, true);
    if (scan.length > 2) return false;
    for (let i = 0; i < scan.length; i++) {
      state.push('text', '', 0).content = '~';
      state.delimiters.push({
        marker: 126,
        length: scan.length,
        token: state.tokens.length - 1,
        end: -1,
        open: scan.can_open,
        close: scan.can_close,
      });
    }
    state.pos += scan.length;
    return true;
  });
  md.inline.ruler2.at('strikethrough', (state) => {
    finish(state, state.delimiters);
    for (const meta of state.tokens_meta) if (meta) finish(state, meta.delimiters);
    return true;
  });
}
