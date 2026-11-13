import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { createViewerResource } from './resource.ts';
import { diffSelection } from './diff-selection.ts';
import { DiffContent } from './DiffContent.jsx';
import { viewMode } from './view.ts';
import { createSourceDOM } from '../editor/source-dom.ts';
import { isMac } from '../lib/keyboard.ts';

const modifier = isMac ? 'metaKey' : 'ctrlKey';

function DiffDocument(props) {
  const editor = useEditor();
  const [data, { refetch }] = createViewerResource(editor, () => props.document, 'api/diff');
  return (
    <Show
      when={!data.loading}
      fallback={
        <p class="p-3" role="status">
          Loading changes…
        </p>
      }
    >
      <Show
        when={!data.error}
        fallback={
          <p class="p-3" role="alert">
            Unable to load changes: {data.error?.message} <button onClick={refetch}>Retry</button>
          </p>
        }
      >
        <Show when={data()} keyed>
          {(data) => (
            <DiffContent
              data={data}
              document={props.document}
              registerRows={props.registerRows}
              top={props.top}
              height={props.height}
              scrollTo={props.scrollTo}
              scrollLine={props.scrollLine}
              stepHunk={props.stepHunk}
            />
          )}
        </Show>
      </Show>
    </Show>
  );
}
export function DiffViewer() {
  const editor = useEditor();
  let viewport;
  const rowLocations = new Set();
  function registerRows(locate) {
    rowLocations.add(locate);
    return () => rowLocations.delete(locate);
  }
  let frame;
  let flashTimer;
  const [top, setTop] = createSignal(0);
  const [height, setHeight] = createSignal(900);
  const visible = () => viewMode(editor.active()) === 'diff';
  // A modified click on a word goes to its definition; a plain click shows its hover card.
  function wordAt(event, definition) {
    const word = createSourceDOM(viewport, editor.active).wordAtPoint(event.clientX, event.clientY);
    if (!word) return;
    editor.actions.setNavigation({ at: word, lastWord: word.word });
    if (definition) {
      event.preventDefault();
      editor.actions.gotoDefinition(word, { view: event.altKey ? 'source' : 'diff' });
    } else editor.actions.showHover(word, event.clientX, event.clientY);
  }
  function currentLine() {
    const top = viewport.getBoundingClientRect().top;
    for (const row of viewport.querySelectorAll('[data-l], [data-at]'))
      if (row.getBoundingClientRect().bottom > top) return +(row.dataset.l || row.dataset.at);
    return editor.active()?.cur || 1;
  }
  function scrollLine(line) {
    let row = viewport.querySelector(
      `[data-l="${line}"], [data-at="${line}"], [data-old-l="${line}"]`,
    );
    if (!row) {
      const location = [...rowLocations]
        .map((locate) => locate(line))
        .find((value) => value !== null);
      if (location !== undefined) {
        viewport.scrollTop = Math.max(0, location - viewport.clientHeight / 2);
        setTop(viewport.scrollTop);
        row = viewport.querySelector(`[data-l="${line}"], [data-at="${line}"]`);
      }
    }
    if (!row && !rowLocations.size) {
      const header = [...viewport.querySelectorAll('[data-new-start]')]
        .reverse()
        .find((head) => +head.dataset.newStart <= line);
      if (header) {
        viewport.scrollTop = header.offsetTop + (line - +header.dataset.newStart) * 20;
        setTop(viewport.scrollTop);
        row = viewport.querySelector(`[data-l="${line}"], [data-at="${line}"]`);
      }
    }
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('diff-row-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => row.classList.remove('diff-row-flash'), 1200);
    }
  }
  function stepHunk(direction) {
    const heads = [...viewport.querySelectorAll('[data-ui~=diff-hunk-head]')].filter(
      (head) => head.getClientRects().length,
    );
    const viewTop = viewport.getBoundingClientRect().top;
    const target =
      direction > 0
        ? heads.find((head) => head.getBoundingClientRect().top - viewTop > 24) || heads[0]
        : heads.reverse().find((head) => head.getBoundingClientRect().top - viewTop < -24) ||
          heads[0];
    target?.scrollIntoView({ block: 'start' });
  }
  onMount(() => {
    const observer = new ResizeObserver(() => setHeight(viewport.clientHeight || 900));
    observer.observe(viewport);
    const selection = () => {
      const selected = window.getSelection();
      if (!visible() || !selected?.rangeCount || selected.isCollapsed) return;
      const info = diffSelection(viewport, selected.getRangeAt(0), editor.active());
      if (info) editor.actions.setSelection(info);
    };
    const service = { currentLine, scrollLine, stepHunk, scrollTop: () => viewport.scrollTop };
    editor.services.diff = service;
    document.addEventListener('selectionchange', selection);
    onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(flashTimer);
      document.removeEventListener('selectionchange', selection);
      if (editor.services.diff === service) delete editor.services.diff;
    });
  });
  return (
    <div
      id="diffview"
      ref={viewport}
      class="absolute inset-0 overflow-auto bg-background"
      hidden={!visible()}
      onScroll={() => {
        editor.actions.rememberDiff(editor.active(), viewport.scrollTop);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => setTop(viewport.scrollTop));
      }}
      onMouseDown={(event) => {
        if (event.target.closest('.diff-code') && event[modifier]) wordAt(event, true);
      }}
      onClick={(event) => {
        if (event.target.closest('.diff-code') && !event[modifier]) wordAt(event, false);
      }}
    >
      <Show when={visible() && editor.active()} keyed>
        {(document) => (
          <DiffDocument
            document={document}
            registerRows={registerRows}
            top={top()}
            height={height()}
            scrollTo={(value) => {
              viewport.scrollTop = value;
            }}
            scrollLine={scrollLine}
            stepHunk={stepHunk}
          />
        )}
      </Show>
    </div>
  );
}
