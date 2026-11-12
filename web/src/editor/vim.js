import { movePosition, selectedText, wordAtColumn } from './cursor.js';
export const initialVimState = () => ({
  mode: 'NORMAL',
  count: '',
  pending: '',
  pendingAt: 0,
  register: '',
});

/** The reader's Vim dialect emits commands; it never touches the DOM or services. */
export function vimKey(previous, event, document, now = 0) {
  const state = { ...previous };
  const cursor = { line: document.line, col: document.col };
  let anchor = document.anchor;
  const commands = [];
  const result = (handled) => ({ state, cursor, anchor, commands, handled });
  const reset = () => {
    state.count = '';
    state.pending = '';
  };
  const normal = () => {
    state.mode = 'NORMAL';
    anchor = null;
    reset();
  };
  const visual = () => state.mode !== 'NORMAL';
  const move = (amount, axis = 'line') => {
    if (visual() && !anchor) anchor = { ...cursor };
    Object.assign(cursor, movePosition(cursor, amount, document.textAt, document.total, axis));
    if (state.mode === 'VISUAL_LINE') cursor.col = document.textAt(cursor.line - 1).length;
  };
  const action = (type, value) => commands.push({ type, value });
  if (state.pending && now - state.pendingAt > 1400) reset();
  if (event.key === 'Escape') {
    const handled = visual() || !!state.count || !!state.pending;
    normal();
    return result(handled);
  }
  if (event.metaKey || event.altKey) return result(false);
  const count = Math.max(1, parseInt(state.count, 10) || 1);
  if (event.ctrlKey) {
    const pages = { d: 0.5, u: -0.5, f: 1, b: -1 };
    if (pages[event.key]) move(Math.trunc(document.pageLines * pages[event.key]) * count);
    else if (event.key === 'o' || event.key === 'i')
      action('history', (event.key === 'o' ? -1 : 1) * count);
    else return result(false);
    reset();
    return result(true);
  }
  if (visual()) {
    const nextMode = event.key === 'V' ? 'VISUAL_LINE' : 'VISUAL';
    if (event.key === 'v' || event.key === 'V') {
      if (state.mode === nextMode) normal();
      else state.mode = nextMode;
      return result(true);
    }
    if (['y', 'Y', 'e', 'c', 'u'].includes(event.key)) {
      const info = selectedText(anchor, cursor, document.textAt);
      if (event.key === 'y') {
        state.register = info?.text || '';
        action('yank', state.register);
      } else {
        const actions = { Y: 'copy-ref', e: 'agent-edit', c: 'agent-edit', u: 'usages' };
        action('selection', actions[event.key]);
      }
      normal();
      return result(true);
    }
  }
  if (!state.pending && /^[0-9]$/.test(event.key) && (state.count || event.key !== '0')) {
    state.count += event.key;
    return result(true);
  }
  if (state.pending === 'g') {
    if (event.key === 'g') {
      cursor.line = Math.min(document.total, count);
      cursor.col = 0;
    }
    if (event.key === 't' || event.key === 'T') action('tab', event.key === 't' ? 1 : -1);
    reset();
    return result(true);
  }
  if (state.pending === 'z') {
    if (['z', 't', 'b'].includes(event.key)) action('scroll', event.key);
    reset();
    return result(true);
  }
  if (state.pending === 'y') {
    const start = { ...cursor };
    if (event.key === 'y') {
      const end = Math.min(document.total, cursor.line + count - 1);
      state.register = Array.from({ length: end - cursor.line + 1 }, (_, at) =>
        document.textAt(cursor.line - 1 + at),
      ).join('\n');
    } else {
      if (event.key === 'w') move(count, 'word');
      else if (event.key === '$') cursor.col = document.textAt(cursor.line - 1).length;
      state.register = selectedText(start, cursor, document.textAt)?.text || '';
      Object.assign(cursor, start);
    }
    action('yank', state.register);
    reset();
    return result(true);
  }
  const motions = {
    h: [-count, 'column'],
    l: [count, 'column'],
    j: [count, 'line'],
    k: [-count, 'line'],
    w: [count, 'word'],
    b: [-count, 'word'],
  };
  if (motions[event.key]) move(...motions[event.key]);
  else if (event.key === '0' || event.key === '$')
    cursor.col = event.key === '0' ? 0 : document.textAt(cursor.line - 1).length;
  else if (event.key === '^')
    cursor.col = Math.max(0, document.textAt(cursor.line - 1).search(/\S/));
  else if (event.key === 'G') {
    cursor.line = state.count ? Math.min(document.total, count) : document.total;
    cursor.col = 0;
  } else if (['H', 'M', 'L'].includes(event.key)) {
    const positions = { H: document.topLine, M: document.middleLine, L: document.bottomLine };
    cursor.line = Math.max(1, Math.min(document.total, positions[event.key]));
  } else if (event.key === 'v' || event.key === 'V') {
    state.mode = event.key === 'v' ? 'VISUAL' : 'VISUAL_LINE';
    anchor = { ...cursor, col: state.mode === 'VISUAL_LINE' ? 0 : cursor.col };
    if (state.mode === 'VISUAL_LINE') cursor.col = document.textAt(cursor.line - 1).length;
  } else if (['g', 'z', 'y'].includes(event.key)) {
    state.pending = event.key;
    state.pendingAt = now;
    return result(true);
  } else if (event.key === 'K') action('hover');
  else if (event.key === '/' || event.key === '?') action('find', event.key === '?' ? -1 : 1);
  else if (event.key === 'n' || event.key === 'N') action('next', event.key === 'n' ? 1 : -1);
  else if (event.key === '*' || event.key === '#') {
    const word = wordAtColumn(document.textAt(cursor.line - 1), cursor.col);
    if (word) action('findWord', { ...word, direction: event.key === '*' ? 1 : -1 });
  } else if (event.key === ':') action('palette');
  else return result(false);
  reset();
  return result(true);
}
