import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { rowWindow } from './tree-model.ts';
import { TreeRow } from './TreeRow.jsx';
export function Tree() {
  const editor = useEditor();
  const tree = editor.tree;
  let viewport;
  let frame;
  const [top, setTop] = createSignal(0);
  const [height, setHeight] = createSignal(600);
  const [focused, setFocused] = createSignal('');
  const rows = tree.rows;
  const window = createMemo(() => rowWindow(rows().length, top(), height()));
  const visible = createMemo(() => rows().slice(window().first, window().last));
  function update() {
    frame = 0;
    setTop(viewport.scrollTop);
    setHeight(viewport.clientHeight);
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  function scrollPath(path) {
    const index = rows().findIndex((row) => row.path === path);
    if (index < 0) return;
    viewport.scrollTop = Math.max(0, index * 24 - viewport.clientHeight / 2 + 12);
    update();
  }
  createEffect(
    on(
      () => tree.state.reveal.sequence,
      () => scrollPath(tree.state.reveal.path),
      { defer: true },
    ),
  );
  onMount(() => {
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    update();
    onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    });
  });
  function navigate(event) {
    if (event.target.closest('input,[role=menu]')) return;
    const index = Math.max(
      0,
      rows().findIndex((row) => row.path === focused()),
    );
    const row = rows()[index];
    if (!row) return;
    let next;
    if (event.key === 'ArrowDown') next = Math.min(rows().length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows().length - 1;
    else if (event.key === 'ArrowRight' && row.dir && !tree.expanded(row.path))
      void editor.actions.toggleTreeDirectory(row.path);
    else if (event.key === 'ArrowLeft' && row.dir && tree.expanded(row.path))
      void editor.actions.toggleTreeDirectory(row.path);
    else if (event.key === 'Enter' || event.key === ' ') {
      if (row.dir) void editor.actions.toggleTreeDirectory(row.path);
      else void editor.actions.openTreeFile(row.path);
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (next !== undefined) {
      setFocused(rows()[next].path);
      scrollPath(rows()[next].path);
    }
  }
  return (
    <div
      id="tree"
      ref={viewport}
      class="panel-body relative min-h-0 flex-1 overflow-auto"
      classList={{
        'changed-only': tree.mode() === 'git',
        'scope-yours': tree.scope() === 'yours',
        'scope-pr': !!editor.store.state.workspace.meta?.pr && tree.scope() === 'all',
      }}
      role="tree"
      tabindex="0"
      aria-label="Files"
      aria-activedescendant={focused() ? 'tree-item-' + encodeURIComponent(focused()) : undefined}
      onScroll={schedule}
      onKeyDown={navigate}
    >
      <Show when={tree.state.error}>
        <p class="p-3 text-destructive" role="alert">
          {tree.state.error}
        </p>
      </Show>
      <Show when={!rows().length && !tree.state.error}>
        <p class="p-3 text-xs text-muted-foreground">
          {tree.mode() === 'git' ? 'Working tree clean' : 'No files'}
        </p>
      </Show>
      <div class="relative min-w-full" style={{ height: `${rows().length * 24}px` }}>
        <div
          class="absolute inset-x-0 top-0"
          style={{ transform: `translateY(${window().first * 24}px)` }}
        >
          <For each={visible()}>{(row) => <TreeRow row={row} />}</For>
        </div>
      </div>
    </div>
  );
}
