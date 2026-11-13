import type { Position } from './cursor.ts';
export interface VimState {
  mode: string;
  count: string;
  pending: string;
  pendingAt: number;
  register: string;
}
export interface VimDocument {
  line: number;
  col: number;
  anchor: Position | null;
  textAt: (index: number) => string;
  total: number;
  tabCount?: number;
  pageLines: number;
  topLine: number;
  middleLine: number;
  bottomLine: number;
}
export type VimCommand =
  | { type: 'yank' | 'selection' | 'scroll'; value: string }
  | { type: 'history' | 'tabIndex' | 'tab' | 'find' | 'next'; value: number }
  | { type: 'findWord'; value: { word: string; col: number; direction: number } }
  | { type: 'definition' | 'references' | 'calls' | 'hover' | 'palette' };
export interface VimResult {
  state: VimState;
  cursor: Position;
  anchor: Position | null;
  commands: VimCommand[];
  handled: boolean;
}
import { movePosition, selectedText, wordAtColumn } from './cursor.ts';
export const initialVimState = (): VimState => ({
  mode: 'NORMAL',
  count: '',
  pending: '',
  pendingAt: 0,
  register: '',
});

/** The reader's Vim dialect emits commands; it never touches the DOM or services. */
export function vimKey(
  previous: VimState,
  event: { key: string; metaKey?: boolean; altKey?: boolean; ctrlKey?: boolean },
  document: VimDocument,
  now = 0,
): VimResult {
  const state = { ...previous };
  const cursor = { line: document.line, col: document.col };
  let anchor = document.anchor;
  const commands: VimCommand[] = [];
  const result = (handled: boolean): VimResult => {
    cursor.line = Math.max(1, Math.min(document.total || 1, cursor.line));
    if (state.mode === 'VISUAL_LINE' && anchor) {
      const reverse = cursor.line < anchor.line;
      anchor = { ...anchor, col: reverse ? document.textAt(anchor.line - 1).length : 0 };
      cursor.col = reverse ? 0 : document.textAt(cursor.line - 1).length;
    }
    return { state, cursor, anchor, commands, handled };
  };
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
  const move = (amount: number, axis = 'line') => {
    if (visual() && !anchor) anchor = { ...cursor };
    Object.assign(cursor, movePosition(cursor, amount, document.textAt, document.total, axis));
    if (state.mode === 'VISUAL_LINE') cursor.col = document.textAt(cursor.line - 1).length;
  };
  if (state.pending && now - state.pendingAt > 1400) reset();
  if (event.key === 'Escape') {
    const handled = visual() || !!state.count || !!state.pending;
    normal();
    return result(handled);
  }
  if (event.metaKey || event.altKey) return result(false);
  const count = Math.max(1, parseInt(state.count, 10) || 1);
  if (event.ctrlKey) {
    const pages: Record<string, number> = { d: 0.5, u: -0.5, f: 1, b: -1 };
    const page = pages[event.key];
    if (page) {
      const size =
        Math.abs(page) === 1 ? document.pageLines - 2 : Math.floor(document.pageLines / 2);
      move(Math.sign(page) * Math.max(1, size) * count);
    } else if (event.key === 'o' || event.key === 'i')
      commands.push({ type: 'history', value: (event.key === 'o' ? -1 : 1) * count });
    else return result(false);
    reset();
    return result(true);
  }
  if (visual()) {
    const nextMode = event.key === 'V' ? 'VISUAL_LINE' : 'VISUAL';
    if (event.key === 'v' || event.key === 'V') {
      if (state.mode === nextMode) normal();
      else {
        state.mode = nextMode;
        if (nextMode === 'VISUAL_LINE') anchor = { line: cursor.line, col: 0 };
      }
      return result(true);
    }
    if (['y', 'Y', 'e', 'c', 'u'].includes(event.key)) {
      const head =
        state.mode === 'VISUAL_LINE'
          ? {
              ...cursor,
              col:
                cursor.line < (anchor?.line ?? cursor.line)
                  ? 0
                  : document.textAt(cursor.line - 1).length,
            }
          : cursor;
      const info = selectedText(anchor, head, document.textAt);
      if (event.key === 'y') {
        state.register = info?.text || '';
        commands.push({ type: 'yank', value: state.register });
      } else {
        const actions: Record<string, string> = {
          Y: 'copy-ref',
          e: 'agent-edit',
          c: 'agent-edit',
          u: 'usages',
        };
        commands.push({ type: 'selection', value: actions[event.key] || '' });
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
    if (event.key === 't') {
      const indexed = state.count && count <= (document.tabCount ?? Infinity);
      commands.push({ type: indexed ? 'tabIndex' : 'tab', value: indexed ? count - 1 : 1 });
    }
    if (event.key === 'T') commands.push({ type: 'tab', value: -1 });
    if (event.key === 'd') commands.push({ type: 'definition' });
    if (event.key === 'r') commands.push({ type: 'references' });
    if (event.key === 'h') commands.push({ type: 'calls' });
    reset();
    return result(true);
  }
  if (state.pending === 'z') {
    if (['z', 't', 'b'].includes(event.key)) commands.push({ type: 'scroll', value: event.key });
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
    commands.push({ type: 'yank', value: state.register });
    reset();
    return result(true);
  }
  const motions: Record<string, [number, string]> = {
    h: [-count, 'column'],
    l: [count, 'column'],
    j: [count, 'line'],
    k: [-count, 'line'],
    w: [count, 'word'],
    b: [-count, 'word'],
  };
  const motion = motions[event.key];
  if (motion) move(...motion);
  else if (event.key === '0' || event.key === '$')
    cursor.col = event.key === '0' ? 0 : document.textAt(cursor.line - 1).length;
  else if (event.key === '^')
    cursor.col = Math.max(0, document.textAt(cursor.line - 1).search(/\S/));
  else if (event.key === 'G') {
    cursor.line = state.count ? Math.min(document.total, count) : document.total;
    cursor.col = 0;
  } else if (['H', 'M', 'L'].includes(event.key)) {
    const positions: Record<string, number> = {
      H: document.topLine,
      M: document.middleLine,
      L: document.bottomLine,
    };
    cursor.line = Math.max(1, Math.min(document.total, positions[event.key] || cursor.line));
  } else if (event.key === 'v' || event.key === 'V') {
    state.mode = event.key === 'v' ? 'VISUAL' : 'VISUAL_LINE';
    anchor = { ...cursor, col: state.mode === 'VISUAL_LINE' ? 0 : cursor.col };
    if (state.mode === 'VISUAL_LINE') cursor.col = document.textAt(cursor.line - 1).length;
  } else if (['g', 'z', 'y'].includes(event.key)) {
    state.pending = event.key;
    state.pendingAt = now;
    return result(true);
  } else if (event.key === 'K') commands.push({ type: 'hover' });
  else if (event.key === '/' || event.key === '?')
    commands.push({ type: 'find', value: event.key === '?' ? -1 : 1 });
  else if (event.key === 'n' || event.key === 'N')
    commands.push({ type: 'next', value: event.key === 'n' ? 1 : -1 });
  else if (event.key === '*' || event.key === '#') {
    const word = wordAtColumn(document.textAt(cursor.line - 1), cursor.col);
    if (word)
      commands.push({
        type: 'findWord',
        value: { ...word, direction: event.key === '*' ? 1 : -1 },
      });
  } else if (event.key === ':') commands.push({ type: 'palette' });
  else return result(false);
  reset();
  return result(true);
}
