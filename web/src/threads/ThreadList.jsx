import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { targetRef } from '../agents/logic.js';
import { relativeTime } from './logic.js';
export function ThreadList() {
  const editor = useEditor();
  return (
    <section id="thr-list-view" class="flex min-h-0 flex-1 flex-col">
      <header class="flex justify-between gap-1 border-b p-2">
        <div class="button-group">
          <For each={['all', 'file']}>
            {(filter) => (
              <button
                class="btn"
                data-thr-filter={filter}
                aria-pressed={editor.threads.state.filter === filter}
                onClick={() => editor.actions.setThreadFilter(filter)}
              >
                {filter === 'all' ? 'All' : 'This file'}
              </button>
            )}
          </For>
        </div>
        <button id="thr-new" class="btn" onClick={() => editor.actions.newThread()}>
          New
        </button>
      </header>
      <div id="thr-list" class="min-h-0 flex-1 overflow-auto p-2">
        <Show when={!editor.threads.list().length}>
          <p class="p-3 text-xs text-muted-foreground">
            No threads yet. Select code and press Alt+T, or start a workspace thread.
          </p>
        </Show>
        <For each={editor.threads.list()}>
          {(thread) => (
            <div class="group flex items-center gap-1 border-b p-2" data-ui="thr-item">
              <button
                class="min-w-0 flex-1 text-left"
                onClick={() => void editor.actions.openThread(thread.id)}
              >
                <strong class="block truncate">
                  {thread.running ? '◌ ' : ''}
                  {thread.title}
                </strong>
                <span class="block truncate font-mono text-xs text-muted-foreground">
                  {targetRef(thread)} · {thread.turns} turns ·{' '}
                  {relativeTime(thread.updated, Date.now())}
                </span>
              </button>
              <button
                class="btn"
                aria-label="Delete thread"
                onClick={() => void editor.actions.deleteThread(thread.id)}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
