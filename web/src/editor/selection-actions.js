import { onCleanup } from 'solid-js';
import { apiText } from '../lib/api.ts';
import { copyRich, copyText } from '../lib/clipboard.ts';
import { toast } from '../lib/toast.jsx';
import { selectedText } from './cursor.js';
import { contextSnippet, selectionRef } from './selection.js';

// The file as it is on disk, or at the ref its diff compares against.
const rawText = (document) =>
  apiText('api/raw', { path: document.path, ref: document.diffRef || '' });

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
  async function selectAll() {
    const document = active();
    if (!document) return;
    const model = buffer();
    let text;
    try {
      text = await rawText(document);
    } catch (error) {
      toast('error', error.message);
      return;
    }
    if (active() !== document || buffer() !== model) return;
    setUI('selection', { text, path: document.path, l1: 1, l2: document.total, all: true });
  }
  // Copies the whole active file; message names what was copied.
  async function copyFile(message) {
    const document = active();
    if (!document) return;
    try {
      await copyText(await rawText(document), message(document));
    } catch (error) {
      toast('error', error.message);
    }
  }
  async function copyMarkdown(info) {
    if (info.rawMarkdown) return copyText(info.rawMarkdown, 'Copied raw Markdown');
    try {
      const text = await rawText(active());
      const lines = text
        .split(/\r?\n/)
        .slice(info.l1 - 1, info.l2)
        .join('\n');
      return copyText(lines || text, 'Copied raw Markdown');
    } catch {
      return copyText(info.text, 'Copied Markdown');
    }
  }
  // Runs a selection action on the selection, or on the caret line for thread and agent edits.
  function runSelectionAction(action, override) {
    let info = override || ui.selection;
    if (!info) {
      const document = active();
      if (!['thread', 'agent-edit'].includes(action) || !document) return false;
      info = {
        path: document.path,
        l1: document.cur,
        l2: document.cur,
        text: buffer()?.text(document.cur - 1) || '',
      };
    }
    const handlers = editor.handlers;
    const direct = {
      thread: handlers.thread,
      'agent-edit': handlers.agent,
      explain: handlers.explain,
      'review-comment': handlers.review,
    };
    if (action === 'explain' && (info.isMarkdownPreview || info.text.length > 12000)) return false;
    if (direct[action]) {
      direct[action](info);
      return true;
    }
    if (action === 'usages') {
      editor.actions.findReferences(info.text.split(/\s+/)[0]);
      return true;
    }
    if (action === 'copy-preview-text') {
      void copyRich(info.text, info.html || '', 'Copied formatted text');
      return true;
    }
    if (action === 'copy-markdown') {
      void copyMarkdown(info);
      return true;
    }
    const values = {
      'copy-ref': selectionRef(info),
      'copy-source': info.text,
      'copy-agent': contextSnippet(info),
    };
    if (values[action] === undefined) return false;
    void copyText(values[action]);
    return true;
  }
  return {
    clearSelection,
    syncSelection,
    selectRange,
    setSelection,
    openSelectionMenu: (info, x, y) => setUI('menu', { info, x, y }),
    openLineActions(info, x, y) {
      const selected = ui.selection;
      const covers =
        selected?.path === info.path && info.l1 >= selected.l1 && info.l1 <= selected.l2;
      setUI('menu', { info: covers ? selected : info, x, y });
    },
    closeSelectionMenu: () => setUI('menu', null),
    runSelectionAction,
    selectAll,
    copyFile,
  };
}
