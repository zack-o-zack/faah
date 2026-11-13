import { onCleanup } from 'solid-js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.jsx';
import { wordAtColumn } from './cursor.js';

export function createHoverActions(editor) {
  const { active, buffer, setUI, services } = editor;
  let request;
  let hoverGeneration = 0;
  onCleanup(() => {
    hoverGeneration++;
    request?.abort();
  });
  async function showHover(at, x, y, options = {}) {
    if (!at) return;
    request?.abort();
    request = new AbortController();
    const mine = ++hoverGeneration;
    setUI({ hoverLoading: true, hoverError: '' });
    try {
      const data = await api(
        'api/lsp/hover',
        { path: at.path, line: at.line, col: at.col, wait: 4000 },
        { signal: request.signal },
      );
      if (mine !== hoverGeneration || active()?.path !== at.path) return;
      editor.actions.acceptLspReply(data);
      const diagnostics = active().diagnostics?.filter((item) => item.line === at.line) || [];
      if ((data.empty || (!data.signature && !data.doc)) && !diagnostics.length) {
        if (options.focus) toast('info', 'No documentation for this symbol');
        return;
      }
      setUI({
        hover: { at, data, diagnostics, focus: !!options.focus },
        hoverPosition: { x, y },
      });
    } catch (error) {
      if (mine === hoverGeneration && error.name !== 'AbortError') {
        setUI('hoverError', error.message);
        if (options.focus) toast('error', error.message);
      }
    } finally {
      if (mine === hoverGeneration) setUI('hoverLoading', false);
    }
  }
  function hideHover() {
    hoverGeneration++;
    request?.abort();
    setUI({ hover: null, hoverLoading: false });
  }
  function wordAtCaret() {
    const document = active();
    const word = document && wordAtColumn(buffer().text(document.cur - 1), document.col || 0);
    return word ? { ...word, line: document.cur, path: document.path } : null;
  }
  function showHoverAtCaret() {
    const document = active();
    const word = document && wordAtColumn(buffer().text(document.cur - 1), document.col || 0);
    const point = services.source?.caretPoint();
    if (word && point)
      return showHover({ ...word, line: document.cur, path: document.path }, point.x, point.y, {
        focus: true,
      });
  }

  return {
    showHover,
    hideHover,
    showHoverAtCaret,
    wordAtCaret,
  };
}
