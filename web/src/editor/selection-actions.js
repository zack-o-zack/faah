import { onCleanup } from 'solid-js';
import { selectedText } from './cursor.js';

export function createSelectionActions(editor) {
  const { active, buffer, ui, setUI, services } = editor;
  const { patch } = editor.actions;
  let prepareTimer;
  onCleanup(() => clearTimeout(prepareTimer));
  function setSelection(info) {
    setUI('selection', info);
    clearTimeout(prepareTimer);
    if (info && !info.isMarkdownPreview && info.text.length <= 12000)
      prepareTimer = setTimeout(() => editor.handlers.prepare?.(info), 400);
  }
  function clearSelection() {
    patch({ selAnchor: null });
    setSelection(null);
    services.source?.clearSelection();
  }
  function syncSelection() {
    const document = active();
    if (!document?.selAnchor) return clearSelection();
    const head = { line: document.cur, col: document.col || 0 };
    const info = selectedText(document.selAnchor, head, buffer().text);
    setSelection(info?.text ? { ...info, path: document.path, isEditor: true } : null);
    services.source?.select(document.selAnchor, head);
  }
  function selectRange(anchor, head) {
    patch({ cur: head.line, col: head.col, selAnchor: anchor });
    const info = selectedText(anchor, head, buffer().text);
    setSelection(info?.text ? { ...info, path: active().path, isEditor: true } : null);
  }
  return {
    clearSelection,
    syncSelection,
    selectRange,
    setSelection,
    openSelectionMenu: (info, x, y) => setUI('menu', { info, x, y }),
    closeSelectionMenu: () => setUI('menu', null),
    runSelectionAction: (action, trigger, override) =>
      services.selectionAction?.(action, override || ui.selection, trigger) || false,
  };
}
