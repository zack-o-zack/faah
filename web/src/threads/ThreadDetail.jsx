import { For, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { AgentPicker } from '../agents/AgentPicker.jsx';
import { targetRef } from '../agents/logic.ts';
import { ThreadTranscript } from './ThreadTranscript.jsx';
export function ThreadDetail() {
  const editor = useEditor();
  const thread = () => editor.threads.current() || editor.threads.state.draft;
  let input;
  onMount(() => input.focus());
  return (
    <section id="thr-thread-view" class="flex min-h-0 flex-1 flex-col">
      <header class="flex items-center gap-2 border-b p-2">
        <button
          id="thr-back"
          class="btn"
          aria-label="All threads"
          onClick={editor.actions.backToThreads}
        >
          ←
        </button>
        <strong id="thr-title" class="min-w-0 flex-1 truncate">
          {thread()?.title || 'New thread'}
        </strong>
        <Show when={editor.threads.current()}>
          <button
            id="thr-delete"
            class="btn"
            aria-label="Delete current thread"
            onClick={() => void editor.actions.deleteThread()}
          >
            Delete
          </button>
        </Show>
      </header>
      <ThreadTranscript id="thr-msgs" thread={editor.threads.current()} />
      <Show
        when={editor.threads.state.pending === 'open' || editor.threads.state.pending === 'explain'}
      >
        <p role="status">Loading thread…</p>
      </Show>
      <div class="flex shrink-0 flex-col gap-2 border-t p-3">
        <Show when={thread()?.path}>
          <button
            id="thr-anchor"
            class="btn truncate font-mono text-xs"
            onClick={() => editor.actions.openFile(thread().path, { line: thread().l1 })}
          >
            {targetRef(thread())}
          </button>
        </Show>
        <Show when={editor.store.state.workspace.meta?.pr}>
          <div
            id="thr-scope"
            class="button-group"
            role="group"
            aria-label="What this thread is about"
          >
            <For each={['pr', 'mine', 'selection']}>
              {(scope) => (
                <button
                  class="btn"
                  data-scope={scope}
                  aria-pressed={(thread()?.scope || 'pr') === scope}
                  disabled={scope === 'selection' && !thread()?.path}
                  onClick={() => void editor.actions.setThreadScope(scope)}
                >
                  {{ pr: 'Whole PR', mine: 'My changes', selection: 'Selection' }[scope]}
                </button>
              )}
            </For>
          </div>
        </Show>
        <textarea
          id="thr-input"
          ref={input}
          class="textarea"
          aria-label="Thread message"
          rows="2"
          value={editor.threads.state.message}
          onInput={(event) => editor.actions.setThreadMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              void editor.actions.sendThread();
            }
            if (event.key === 'Escape') input.blur();
          }}
        />
        <footer class="flex items-center justify-between gap-2">
          <AgentPicker disabled={editor.threads.running()} />
          <button
            id="thr-send"
            class="btn"
            aria-label={editor.threads.running() ? 'Stop this reply' : 'Send (Enter)'}
            disabled={
              !editor.threads.running() &&
              (!!editor.threads.state.pending || !editor.threads.state.message.trim())
            }
            onClick={() => {
              if (editor.threads.running()) void editor.actions.cancelThread();
              else void editor.actions.sendThread();
            }}
          >
            {editor.threads.running() ? 'Stop' : 'Send'}
          </button>
        </footer>
      </div>
    </section>
  );
}
