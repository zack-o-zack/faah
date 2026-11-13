import type { Position } from './cursor.ts';
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createResource,
  Index,
  on,
  Show,
  onCleanup,
  onMount,
} from 'solid-js';
import { useEditor } from './context.tsx';
import { viewMode } from '../viewers/view.ts';
import { visibleRange } from './layout.ts';
import { createHighlights } from './highlights.ts';
import { EditorRow } from './EditorRow.tsx';
import { Caret } from './Caret.tsx';
import { createSourceDOM } from './source-dom.ts';

export function Viewport(): JSX.Element {
  const editor = useEditor();
  let viewport: HTMLDivElement | undefined;
  let rows: HTMLDivElement | undefined;
  let dom: ReturnType<typeof createSourceDOM> | undefined;
  let selectionFrame = 0;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  const covered = () => {
    const document = editor.active();
    return !!document && (document.isEditing || viewMode(document) !== 'source');
  };
  const highlights = createHighlights();
  const rowObserver = new ResizeObserver((entries) => {
    const measurements = entries.map((entry): [number, number] => [
      +(entry.target.getAttribute('data-l') || 0) - 1,
      entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height,
    ]);
    editor.buffer()?.measureHeights(measurements);
  });
  onCleanup(() => rowObserver.disconnect());
  const offsets = createMemo(editor.offsets);
  const range = createMemo(() =>
    covered()
      ? { first: 0, last: 0 }
      : visibleRange(offsets(), editor.geometry.top, editor.geometry.height),
  );
  const contentWidth = () =>
    Math.max(
      editor.geometry.width,
      (editor.active()?.maxCols || 0) * editor.geometry.charWidth + 100,
    );
  const slots = createMemo(() =>
    Array.from({ length: range().last - range().first }, (_, slot) => range().first + slot),
  );
  let frame = 0;
  const update = () => {
    frame = 0;
    if (!viewport || !viewport.clientWidth || !viewport.clientHeight) return;
    editor.setGeometry({
      top: viewport.scrollTop,
      height: viewport.clientHeight,
      width: viewport.clientWidth,
    });
    editor.actions.patch({ scrollTop: viewport.scrollTop });
  };
  function onScroll() {
    if (editor.ui.hover) editor.actions.hideHover();
    if (!frame) frame = requestAnimationFrame(update);
  }
  const [loaded, { refetch }] = createResource(
    () => ({ model: editor.buffer(), ...range() }),
    ({ model, first, last }) => model?.ensure(first, last),
  );
  function applySelection(anchor: Position | null, head: Position | null) {
    if (!anchor || !head) return;
    const start = dom?.toPoint(anchor);
    const end = dom?.toPoint(head);
    if (start && end) window.getSelection()?.setBaseAndExtent(...start, ...end);
  }
  function readSelection() {
    if (!viewport || !dom) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      if (!editor.ui.selection?.all) editor.actions.clearSelection();
      return;
    }
    if (!viewport.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    const anchor = dom.toPos(selection.anchorNode, selection.anchorOffset);
    const head = dom.toPos(selection.focusNode, selection.focusOffset);
    if (selection.isCollapsed) {
      // Keep the browser's caret range: it is also the anchor for a mouse drag.
      if (!editor.ui.selection?.all && head) editor.actions.selectRange(null, head);
      return;
    }
    if (anchor && head) editor.actions.selectRange(anchor, head);
  }
  function scheduleSelection() {
    if (selectionFrame) return;
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0;
      readSelection();
    });
  }
  function measureCaret(position: Position) {
    const point = dom?.toPoint(position);
    if (!point || !viewport) return null;
    const range = document.createRange();
    range.setStart(...point);
    range.collapse(true);
    const rect = range.getClientRects()[0];
    if (!rect) return null;
    const host = viewport.getBoundingClientRect();
    return {
      x: rect.left - host.left + viewport.scrollLeft,
      y: rect.top - host.top + viewport.scrollTop,
    };
  }
  function movePointer(event: MouseEvent) {
    if (!dom) return;
    clearTimeout(hoverTimer);
    const { clientX: x, clientY: y } = event;
    if (event.metaKey || event.ctrlKey) {
      editor.actions.hideHover();
      editor.actions.setNavigation({ link: dom.wordAtPoint(x, y) });
      return;
    }
    editor.actions.setNavigation({ link: null });
    const lsp = editor.store.state.lsp.state;
    if (editor.ui.hover || !editor.settings.preferences().hover) return;
    if (lsp !== 'ready' && lsp !== 'indexing') return;
    hoverTimer = setTimeout(
      () => editor.actions.showHover(dom?.wordAtPoint(x, y) || null, x, y),
      380,
    );
  }
  createEffect(
    on(
      slots,
      () => {
        const document = editor.active();
        if (!document?.selAnchor) return;
        const frame = requestAnimationFrame(() =>
          applySelection(document.selAnchor, { line: document.cur, col: document.col || 0 }),
        );
        onCleanup(() => cancelAnimationFrame(frame));
      },
      { defer: true },
    ),
  );
  onMount(() => {
    const host = viewport;
    const list = rows;
    if (!host || !list) return;
    dom = createSourceDOM(list, editor.active);
    const view = {
      topLine: () => offsets().findIndex((value) => value >= host.scrollTop) || 1,
      scrollTo: (top: number) => {
        host.scrollTop = top;
      },
      focus: () => host.focus({ preventScroll: true }),
      select: applySelection,
      clearSelection() {
        const selection = window.getSelection();
        if (selection?.rangeCount && host.contains(selection.getRangeAt(0).commonAncestorContainer))
          selection.removeAllRanges();
      },
      caretPoint() {
        const rect = dom?.rowFor(editor.active()?.cur || 1)?.getBoundingClientRect();
        return rect ? { x: rect.left + 40, y: rect.top } : null;
      },
    };
    editor.services.source = view;
    const observer = new ResizeObserver(onScroll);
    observer.observe(host);
    document.addEventListener('selectionchange', scheduleSelection);
    document.addEventListener('mouseup', scheduleSelection);
    update();
    onCleanup(() => {
      delete editor.services.source;
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(selectionFrame);
      clearTimeout(hoverTimer);
      document.removeEventListener('selectionchange', scheduleSelection);
      document.removeEventListener('mouseup', scheduleSelection);
    });
  });
  return (
    <div
      id="viewport"
      ref={viewport}
      tabindex="0"
      class={`absolute inset-0 overflow-auto [body.word-wrap_&]:overflow-x-hidden [contain:strict]
        cursor-text`}
      hidden={editor.active()?.isEditing}
      inert={covered()}
      style={{ visibility: covered() ? 'hidden' : undefined }}
      onScroll={onScroll}
      onMouseDown={(event) => {
        if (
          event.button !== 0 ||
          !(event.target instanceof Element) ||
          event.target.closest('button') ||
          !dom
        )
          return;
        const row = event.target.closest<HTMLElement>('.row');
        if (!row) return;
        const at = dom.pointAt(event.clientX, event.clientY) || {
          line: +(row.dataset.l || 1),
          col: 0,
        };
        const document = editor.active();
        if (!document) return;
        editor.actions.patch({
          cur: at.line,
          col: at.col,
          selAnchor: event.shiftKey
            ? document.selAnchor || { line: document.cur, col: document.col || 0 }
            : null,
        });
        const word = dom?.wordAtPoint(event.clientX, event.clientY);
        editor.actions.setNavigation({ at: word, lastWord: word?.word || '' });
        if ((event.metaKey || event.ctrlKey) && word) {
          event.preventDefault();
          editor.actions.gotoDefinition(word, { view: event.altKey ? 'diff' : undefined });
        }
        if (event.shiftKey) editor.actions.syncSelection();
      }}
      onContextMenu={(event) => {
        const info = editor.ui.selection;
        if (!info) return;
        event.preventDefault();
        editor.actions.openSelectionMenu(info, event.clientX, event.clientY);
      }}
      onDblClick={(event) => {
        const word = dom?.wordAtPoint(event.clientX, event.clientY);
        editor.actions.setNavigation({ occurrence: word?.word || null });
      }}
      onMouseMove={movePointer}
    >
      <div
        id="sizer"
        class="relative"
        style={{
          height: `${(offsets().at(-1) || 0) + Math.max(120, editor.geometry.height / 2)}px`,
          width: editor.settings.preferences().wrap ? '100%' : `${contentWidth()}px`,
        }}
      >
        <div
          id="rows"
          ref={rows}
          class="absolute top-0 left-0 w-full will-change-transform"
          style={{ transform: `translateY(${offsets()[range().first] || 0}px)` }}
        >
          <Index each={slots()}>
            {(index) => (
              <EditorRow index={index()} highlights={highlights} observer={rowObserver} />
            )}
          </Index>
        </div>
        <Caret measurePosition={measureCaret} />
        <Show when={loaded.error}>
          <button class="btn absolute top-2 left-2" onClick={refetch}>
            Retry loading lines
          </button>
        </Show>
      </div>
    </div>
  );
}
