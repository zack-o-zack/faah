interface SelectionSetter {
  (patch: Partial<SelectionState>): void;
  (key: 'selection', value: SelectionInfo | null): void;
  (key: 'menu', value: { info: SelectionInfo; x: number; y: number } | null): void;
}
import type { Accessor } from 'solid-js';
interface SelectionDocument {
  path: string;
  cur: number;
  col?: number;
  total: number;
  name: string;
  diffRef: string;
  selAnchor: Position | null;
}
interface SelectionState {
  selection: SelectionInfo | null;
  menu: { info: SelectionInfo; x: number; y: number } | null;
}
interface SelectionHost {
  ui: SelectionState;
  setUI: SelectionSetter;
  active: Accessor<SelectionDocument | null>;
  buffer: Accessor<{ text: (index: number) => string } | undefined>;
  services: Services;
  handlers: {
    prepare?: (info: SelectionInfo) => void;
    thread?: (info: SelectionInfo) => void;
    agent?: (info: SelectionInfo) => void;
    explain?: (info: SelectionInfo) => void;
    review?: (info: SelectionInfo) => void;
  };
  actions: { patch: (patch: Partial<DocTab>) => void; findReferences: (word?: string) => void };
}
import type { Services } from './contracts.ts';
import type { DocTab } from './types.ts';
import type { Position } from './cursor.ts';
import type { SelectionInfo } from './selection.ts';
import { errorMessage } from '../lib/decode.ts';
import { onCleanup } from 'solid-js';
import { apiText } from '../lib/api.ts';
import { copyRich, copyText } from '../lib/clipboard.ts';
import { toast } from '../lib/toast.jsx';
import { selectedText } from './cursor.ts';
import { contextSnippet, selectionRef } from './selection.ts';

// The file as it is on disk, or at the ref its diff compares against.
const rawText = (document: SelectionDocument) =>
  apiText('api/raw', { path: document.path, ref: document.diffRef || '' });

export function createSelectionActions(
  editor: SelectionHost,
): ReturnType<typeof buildSelectionActions> {
  return buildSelectionActions(editor);
}
function buildSelectionActions(editor: SelectionHost) {
  const { active, buffer, ui, setUI, services } = editor;
  const { patch } = editor.actions;
  let prepareTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(prepareTimer));
  function setSelection(info: SelectionInfo | null) {
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
    const info = selectedText(
      document.selAnchor,
      head,
      (index: number) => buffer()?.text(index) || '',
    );
    setSelection(info?.text ? { ...info, path: document.path, isEditor: true } : null);
    services.source?.select(document.selAnchor, head);
  }
  function selectRange(anchor: Position | null, head: Position) {
    patch({ cur: head.line, col: head.col, selAnchor: anchor });
    const info = selectedText(anchor, head, (index: number) => buffer()?.text(index) || '');
    setSelection(info?.text ? { ...info, path: active()?.path || '', isEditor: true } : null);
  }
  async function selectAll() {
    const document = active();
    if (!document) return;
    const model = buffer();
    let text;
    try {
      text = await rawText(document);
    } catch (error) {
      toast('error', errorMessage(error));
      return;
    }
    if (active() !== document || buffer() !== model) return;
    setUI('selection', { text, path: document.path, l1: 1, l2: document.total, all: true });
  }
  // Copies the whole active file; message names what was copied.
  async function copyFile(message: (document: SelectionDocument) => string) {
    const document = active();
    if (!document) return;
    try {
      await copyText(await rawText(document), message(document));
    } catch (error) {
      toast('error', errorMessage(error));
    }
  }
  async function copyMarkdown(info: SelectionInfo) {
    if (info.rawMarkdown) return copyText(info.rawMarkdown, 'Copied raw Markdown');
    try {
      const document = active();
      if (!document) return;
      const text = await rawText(document);
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
  function runSelectionAction(action: string, override?: SelectionInfo | null) {
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
    const direct: Record<string, ((info: SelectionInfo) => void) | undefined> = {
      thread: handlers.thread,
      'agent-edit': handlers.agent,
      explain: handlers.explain,
      'review-comment': handlers.review,
    };
    if (action === 'explain' && (info.isMarkdownPreview || info.text.length > 12000)) return false;
    const handler = direct[action];
    if (handler) {
      handler(info);
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
    const values: Record<string, string> = {
      'copy-ref': selectionRef(info),
      'copy-source': info.text,
      'copy-agent': contextSnippet(info),
    };
    const value = values[action];
    if (value === undefined) return false;
    void copyText(value);
    return true;
  }
  return {
    clearSelection,
    syncSelection,
    selectRange,
    setSelection,
    openSelectionMenu: (info: SelectionInfo, x: number, y: number) => setUI('menu', { info, x, y }),
    openLineActions(info: SelectionInfo, x: number, y: number) {
      const selected = ui.selection;
      const covers =
        selected && selected.path === info.path && info.l1 >= selected.l1 && info.l1 <= selected.l2;
      setUI('menu', { info: covers ? selected : info, x, y });
    },
    closeSelectionMenu: () => setUI('menu', null),
    runSelectionAction,
    selectAll,
    copyFile,
  };
}
