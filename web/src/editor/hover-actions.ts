import { decodeHover } from './decode.ts';
import type { EditorHost, WordPosition } from './contracts.ts';
import { errorMessage, isAbort } from '../lib/decode.ts';
import { onCleanup } from 'solid-js';
import { api } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { wordAtColumn } from './cursor.ts';

export function createHoverActions(editor: EditorHost): ReturnType<typeof buildHoverActions> {
  return buildHoverActions(editor);
}
function buildHoverActions(editor: EditorHost) {
  const { active, buffer, setUI, services } = editor;
  let request: AbortController | undefined;
  let hoverGeneration = 0;
  onCleanup(() => {
    hoverGeneration++;
    request?.abort();
  });
  async function showHover(
    at: WordPosition | null,
    x: number,
    y: number,
    options: { focus?: boolean } = {},
  ) {
    if (!at) return;
    request?.abort();
    request = new AbortController();
    const mine = ++hoverGeneration;
    setUI({ hoverLoading: true, hoverError: '' });
    try {
      const data = decodeHover(
        await api(
          'api/lsp/hover',
          { path: at.path, line: at.line, col: at.col, wait: 4000 },
          { signal: request.signal },
        ),
      );
      if (mine !== hoverGeneration || active()?.path !== at.path) return;
      editor.actions.acceptLspReply(data);
      const diagnostics = active()?.diagnostics?.filter((item) => item.line === at.line) || [];
      if ((data.empty || (!data.signature && !data.doc)) && !diagnostics.length) {
        if (options.focus) toast('info', 'No documentation for this symbol');
        return;
      }
      setUI({
        hover: { at, data, diagnostics, focus: !!options.focus },
        hoverPosition: { x, y },
      });
    } catch (error) {
      if (mine === hoverGeneration && !isAbort(error)) {
        setUI('hoverError', errorMessage(error));
        if (options.focus) toast('error', errorMessage(error));
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
    const word =
      document && wordAtColumn(buffer()?.text(document.cur - 1) || '', document.col || 0);
    return word ? { ...word, line: document.cur, path: document.path } : null;
  }
  function showHoverAtCaret() {
    const document = active();
    const word =
      document && wordAtColumn(buffer()?.text(document.cur - 1) || '', document.col || 0);
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
