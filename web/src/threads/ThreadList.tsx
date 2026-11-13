import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ThreadListRow } from './ThreadListRow.tsx';
import { keyLabel } from '../lib/keyboard.ts';
export function ThreadList(): JSX.Element {
  const editor = useEditor();
  return (
    <section id="thr-list-view" class="flex flex-1 min-h-0 flex-col">
      <header class="inspector-bar flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <div class="button-group" id="thr-filter" role="group">
          <For each={['all', 'file']}>
            {(filter) => (
              <button
                class="btn"
                data-control="opt"
                data-size="xs"
                data-variant={editor.threads.state.filter === filter ? 'secondary' : 'outline'}
                data-thr-filter={filter}
                aria-pressed={editor.threads.state.filter === filter ? true : undefined}
                onClick={() => editor.actions.setThreadFilter(filter)}
              >
                {filter === 'all' ? 'All' : 'This file'}
              </button>
            )}
          </For>
        </div>
        <button
          id="thr-new"
          class="btn"
          onClick={() => editor.actions.newThread(null)}
          data-variant="primary"
          data-size="xs"
          data-control="thr-btn-primary"
        >
          <span class="icon-[lucide--plus] size-3.5" aria-hidden="true" />
          New
        </button>
      </header>
      <div
        id="thr-list"
        class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2 [&>*]:shrink-0"
      >
        <Show when={!editor.threads.list().length}>
          <div data-ui="hint" class="empty text-muted-foreground">
            {editor.threads.state.filter === 'file'
              ? 'No threads started in this file. Select code and press '
              : 'No threads yet. Select code and press '}
            <b>{keyLabel('Alt+T')}</b>
            {editor.threads.state.filter === 'file'
              ? ' to start one.'
              : ', or use New to start a long-running conversation.'}
          </div>
        </Show>
        <For each={editor.threads.list()}>
          {(thread) => (
            <ThreadListRow
              thread={thread}
              selected={editor.threads.state.current === thread.id}
              onOpen={() => void editor.actions.openThread(thread.id)}
              onDelete={() => void editor.actions.deleteThread(thread.id)}
            />
          )}
        </For>
      </div>
    </section>
  );
}
