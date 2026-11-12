import { onCleanup } from 'solid-js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.jsx';
import { findMatches, hitIndex } from './find.js';

export function createFindActions(editor) {
  const { active, buffer, ui, setUI, services } = editor;
  const { patch, centerLine } = editor.actions;
  let findTimer;
  let findRequest;
  let sequence = 0;
  onCleanup(() => {
    clearTimeout(findTimer);
    findRequest?.abort();
  });
  async function executeFind(delta = 0) {
    const document = active();
    if (!document) return;
    const mine = ++sequence;
    findRequest?.abort();
    const query = ui.query;
    let hits = [];
    if (services.previewing?.()) {
      hits = services.findPreview?.(query, ui.caseSensitive) || [];
    } else if (document.isEditing) {
      hits = findMatches(buffer().editContent || '', query, ui.caseSensitive);
    } else if (query) {
      setUI({ findLoading: true, findError: '' });
      findRequest = new AbortController();
      let result;
      try {
        result = await api(
          'api/search',
          {
            q: query,
            glob: document.path,
            case: ui.caseSensitive ? 1 : '',
          },
          { signal: findRequest.signal },
        );
      } catch (error) {
        if (mine === sequence && error.name !== 'AbortError') {
          setUI('findError', error.message);
          toast('error', error.message);
        }
        return;
      } finally {
        if (mine === sequence) setUI('findLoading', false);
      }
      const file = result.results?.find((file) => file.path === document.path);
      let previousLine = -1;
      let occurrence = 0;
      hits = (file?.matches || []).map((match) => {
        occurrence = match.line === previousLine ? occurrence + 1 : 0;
        previousLine = match.line;
        return { line: match.line, n: occurrence };
      });
    }
    if (mine !== sequence || active()?.path !== document.path) return;
    setUI({ hits, activeHit: hits.length ? hitIndex(0, delta, hits.length) : -1 });
    jumpToHit(ui.activeHit);
  }
  function jumpToHit(index) {
    if (!ui.hits.length) return;
    const next = hitIndex(0, index, ui.hits.length);
    setUI('activeHit', next);
    if (services.previewing?.()) return services.showPreviewHit?.(next);
    const hit = ui.hits[next];
    patch({ cur: hit.line });
    if (active()?.isEditing) editor.actions.centerEditLine(hit.line, hit.start, hit.end);
    else centerLine(hit.line);
  }
  function openFind(seed = '', delta = 0) {
    const selected = active()?.isEditing
      ? services.edit?.selectedText() || ''
      : ui.selection?.text || '';
    const line = selected
      .split(/\r?\n/)
      .find((value) => value.trim())
      ?.trim();
    const query = ui.findOpen ? ui.query : seed || ui.query;
    setUI({ findOpen: true, query: line || query });
    queueMicrotask(() => {
      services.find?.focus();
    });
    if (ui.query) void executeFind(delta);
  }
  function clearFind() {
    sequence++;
    clearTimeout(findTimer);
    findRequest?.abort();
    setUI({ findOpen: false, findLoading: false, findError: '', hits: [], activeHit: -1 });
    services.clearPreviewMarks?.();
    if (active()?.isEditing) services.edit?.focus();
    else services.source?.focus();
  }
  return {
    executeFind,
    jumpToHit,
    openFind,
    clearFind,
    nextMatch: (delta) => editor.actions.jumpToHit(ui.activeHit + delta),
    query(value) {
      sequence++;
      findRequest?.abort();
      setUI({ query: value, findLoading: false, findError: '' });
      clearTimeout(findTimer);
      findTimer = setTimeout(() => void editor.actions.executeFind(), 140);
    },
  };
}
