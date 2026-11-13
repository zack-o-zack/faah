import type { DiffScrollProps, RowLocator } from './diff-view.ts';
import { decodeDiff } from './decode.ts';
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { createViewerResource } from './resource.ts';
import { diffSelection } from './diff-selection.ts';
import { DiffContent } from './DiffContent.tsx';
import { viewMode } from './view.ts';
import { createSourceDOM } from '../editor/source-dom.ts';
import { isMac } from '../lib/keyboard.ts';

const modifier = isMac ? 'metaKey' : 'ctrlKey';

function DiffDocument(props: DiffScrollProps): JSX.Element {
  const editor = useEditor();
  const [data, { refetch }] = createViewerResource(
    editor,
    () => props.document,
    'api/diff',
    decodeDiff,
  );
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
export function DiffViewer(): JSX.Element {
  const editor = useEditor();
  let viewport: HTMLDivElement | undefined;
  const rowLocations = new Set<RowLocator>();
  function registerRows(locate: RowLocator) {
    rowLocations.add(locate);
    return () => rowLocations.delete(locate);
  }
  let frame = 0;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const [top, setTop] = createSignal(0);
  const [height, setHeight] = createSignal(900);
  const visible = () => viewMode(editor.active()) === 'diff';
  // A modified click on a word goes to its definition; a plain click shows its hover card.
  function wordAt(event: MouseEvent, definition: boolean) {
    if (!viewport) return;
    const word = createSourceDOM(viewport, editor.active).wordAtPoint(event.clientX, event.clientY);
    if (!word) return;
    editor.actions.setNavigation({ at: word, lastWord: word.word });
    if (definition) {
      event.preventDefault();
      editor.actions.gotoDefinition(word, { view: event.altKey ? 'source' : 'diff' });
    } else editor.actions.showHover(word, event.clientX, event.clientY);
  }
  function currentLine() {
    if (!viewport) return editor.active()?.cur || 1;
    const top = viewport.getBoundingClientRect().top;
    for (const row of viewport.querySelectorAll<HTMLElement>('[data-l], [data-at]'))
      if (row.getBoundingClientRect().bottom > top) return +(row.dataset.l || row.dataset.at || 1);
    return editor.active()?.cur || 1;
  }
  function scrollLine(line: number) {
    if (!viewport) return;
    let row = viewport.querySelector<HTMLElement>(
      `[data-l="${line}"], [data-at="${line}"], [data-old-l="${line}"]`,
    );
    if (!row) {
      const location = [...rowLocations]
        .map((locate) => locate(line))
        .find((value) => value !== null);
      if (location !== undefined) {
        viewport.scrollTop = Math.max(0, location - viewport.clientHeight / 2);
        setTop(viewport?.scrollTop || 0);
        row = viewport.querySelector<HTMLElement>(`[data-l="${line}"], [data-at="${line}"]`);
      }
    }
    if (!row && !rowLocations.size) {
      const header = [...viewport.querySelectorAll<HTMLElement>('[data-new-start]')]
        .reverse()
        .find((head) => +(head.dataset.newStart || 1) <= line);
      if (header) {
        viewport.scrollTop = header.offsetTop + (line - +(header.dataset.newStart || 1)) * 20;
        setTop(viewport?.scrollTop || 0);
        row = viewport.querySelector<HTMLElement>(`[data-l="${line}"], [data-at="${line}"]`);
      }
    }
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('diff-row-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => row?.classList.remove('diff-row-flash'), 1200);
    }
  }
  function stepHunk(direction: number) {
    if (!viewport) return;
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
    const host = viewport;
    if (!host) return;
    const observer = new ResizeObserver(() => setHeight(host.clientHeight || 900));
    observer.observe(host);
    const selection = () => {
      const selected = window.getSelection();
      if (!visible() || !selected?.rangeCount || selected.isCollapsed) return;
      const active = editor.active();
      if (!active) return;
      const info = diffSelection(host, selected.getRangeAt(0), active);
      if (info) editor.actions.setSelection(info);
    };
    const service = { currentLine, scrollLine, stepHunk, scrollTop: () => host.scrollTop };
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
        if (!viewport) return;
        const active = editor.active();
        if (active) editor.actions.rememberDiff(active, viewport.scrollTop);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => setTop(viewport?.scrollTop || 0));
      }}
      onMouseDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('.diff-code') &&
          event[modifier]
        )
          wordAt(event, true);
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('.diff-code') &&
          !event[modifier]
        )
          wordAt(event, false);
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
              if (viewport) viewport.scrollTop = value;
            }}
            scrollLine={scrollLine}
            stepHunk={stepHunk}
          />
        )}
      </Show>
    </div>
  );
}
