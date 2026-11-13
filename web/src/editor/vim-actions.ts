import type { EditorHost } from './contracts.ts';
import { onCleanup } from 'solid-js';
import { initialVimState, vimKey } from './vim.ts';
import { lineIndexAtY } from './layout.ts';
import { copyText } from '../lib/clipboard.ts';

export function createVimActions(editor: EditorHost) {
  const { active, buffer, store, ui, setUI, geometry, offsets, services } = editor;
  const { patch, revealLine, activateView } = editor.actions;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(pendingTimer));
  function handleVimKeyDown(event: KeyboardEvent) {
    const document = active();
    if (!editor.settings.preferences().vim || !document) return false;
    const model = buffer();
    if (!model) return;
    const selection = ui.selection;
    const result = vimKey(
      ui.vim,
      event,
      {
        line: document.cur,
        col: document.col || 0,
        anchor: document.selAnchor,
        textAt: model.text,
        total: document.total,
        tabCount: store.state.documents.tabs.length,
        pageLines: Math.floor(geometry.height / geometry.lineHeight),
        topLine: lineIndexAtY(offsets(), geometry.top) + 1,
        middleLine: lineIndexAtY(offsets(), geometry.top + geometry.height / 2) + 1,
        bottomLine:
          lineIndexAtY(
            offsets(),
            Math.max(0, geometry.top + geometry.height - geometry.lineHeight),
          ) + 1,
      },
      performance.now(),
    );
    if (!result.handled) return false;
    const previousPending = ui.vim.pending;
    setUI('vim', result.state);
    clearTimeout(pendingTimer);
    if (result.state.pending)
      pendingTimer = setTimeout(() => setUI('vim', { pending: '', count: '' }), 1400);
    const moved = result.cursor.line !== document.cur || result.cursor.col !== document.col;
    const jumped = event.key === 'G' || (previousPending === 'g' && event.key === 'g');
    patch({ cur: result.cursor.line, col: result.cursor.col, selAnchor: result.anchor });
    editor.actions.syncSelection();
    if (jumped) {
      services.source?.scrollTo(
        Math.max(0, (offsets()[result.cursor.line - 1] || 0) - geometry.lineHeight * 3),
      );
    } else if (moved) revealLine(result.cursor.line);
    for (const command of result.commands) {
      if (command.type === 'yank') void copyText(command.value);
      if (command.type === 'selection') editor.actions.runSelectionAction(command.value, selection);
      if (command.type === 'tabIndex') editor.actions.switchTab(command.value);
      if (command.type === 'definition') editor.actions.gotoDefinition();
      if (command.type === 'references') editor.actions.findReferences();
      if (command.type === 'calls') editor.actions.showCalls();
      if (command.type === 'hover') editor.actions.showHoverAtCaret();
      if (command.type === 'find') {
        editor.actions.openFind('', command.value < 0 ? -1 : 0);
      }
      if (command.type === 'next') editor.actions.jumpToHit(ui.activeHit + command.value);
      if (command.type === 'findWord') {
        const word = { ...command.value, line: document.cur, path: document.path };
        store.actions.setNavigation({ at: word, lastWord: word.word, occurrence: word.word });
        setUI('query', word.word);
        editor.actions.openFind(word.word, command.value.direction);
      }
      if (command.type === 'history')
        void store.actions.historyGo(command.value).then(activateView);
      if (command.type === 'tab')
        editor.actions.switchTab(
          (store.state.documents.active + command.value + store.state.documents.tabs.length) %
            store.state.documents.tabs.length,
        );
      if (command.type === 'palette') editor.actions.openPalette('command');
      if (command.type === 'scroll') {
        const y = offsets()[document.cur - 1] || 0;
        const alignment: Record<string, number> = {
          z: geometry.height / 2,
          t: 0,
          b: geometry.height - geometry.lineHeight * 2,
        };
        services.source?.scrollTo(Math.max(0, y - (alignment[command.value] || 0)));
      }
    }
    return true;
  }
  return {
    handleVimKeyDown,
    showVimHelp: () => setUI('vimHelp', true),
    hideVimHelp: () => setUI('vimHelp', false),
    setVimEnabled(enabled: boolean) {
      if (!enabled) {
        clearTimeout(pendingTimer);
        setUI('vim', initialVimState());
        editor.actions.clearSelection();
      }
      void editor.settings.actions.setSetting('editor.vimMode', !!enabled);
    },
  };
}
