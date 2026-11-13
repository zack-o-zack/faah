import type { JSX } from 'solid-js';
import { For, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { AgentPicker } from '../agents/AgentPicker.tsx';
import { targetRef } from '../agents/logic.ts';
import { ThreadTranscript } from './ThreadTranscript.tsx';
export function ThreadDetail(): JSX.Element {
  const editor = useEditor();
  const scopeLabels: Record<string, string> = {
    pr: 'Whole PR',
    mine: 'My changes',
    selection: 'Selection',
  };
  const thread = () => editor.threads.current() || editor.threads.state.draft;
  let input: HTMLTextAreaElement | undefined;
  onMount(() => {
    if (editor.threads.state.draft) input?.focus();
    editor.actions.clearSelection?.();
  });
  return (
    <section id="thr-thread-view" data-ui="thr-view" class="flex flex-1 min-h-0 flex-col">
      <div
        data-ui="thr-head"
        class="inspector-bar flex shrink-0 items-center gap-2 border-b px-3 py-2"
      >
        <button
          id="thr-back"
          class="btn"
          data-control="icon-action"
          data-variant="ghost"
          data-size="icon-xs"
          aria-label="All threads"
          onClick={editor.actions.backToThreads}
        >
          <span class="icon-[lucide--arrow-left] size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <span id="thr-title" class="min-w-0 flex-1 truncate text-sm font-medium">
          {editor.threads.current()?.title || 'New thread'}
        </span>
        <Show when={editor.threads.current()}>
          <button
            id="thr-delete"
            class="btn"
            data-control="icon-action"
            data-variant="ghost"
            data-size="icon-xs"
            aria-label="Delete current thread"
            onClick={() => void editor.actions.deleteThread()}
          >
            <span class="icon-[lucide--trash-2] size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </Show>
      </div>
      <ThreadTranscript
        id="thr-msgs"
        thread={editor.threads.current()}
        empty={
          thread()?.path
            ? 'Ask a question about this code, or ask for changes. The reply can touch any file.'
            : 'Ask anything about this workspace. The reply can touch any file.'
        }
      />
      <Show
        when={editor.threads.state.pending === 'open' || editor.threads.state.pending === 'explain'}
      >
        <p role="status">Loading thread…</p>
      </Show>
      <div data-ui="thr-compose" class="flex flex-col gap-1.5 px-3 pt-1 pb-3">
        <div data-ui="thr-box" class="input-group" data-orientation="vertical">
          <header
            data-ui="thr-context"
            data-align="block-start"
            class="hidden flex-wrap gap-1.5 has-[>:not([hidden])]:flex"
          >
            <Show when={thread()?.path}>
              <button
                type="button"
                id="thr-anchor"
                data-ui="thr-anchor"
                class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground [&.jump]:cursor-pointer [&.jump]:hover:text-foreground jump"
                onClick={() =>
                  editor.actions.openFile(thread()?.path || '', { line: thread()?.l1 })
                }
              >
                <span class="icon-[lucide--file-code] size-3 shrink-0" aria-hidden="true" />
                <span data-ui="thr-anchor-text" class="truncate">
                  {targetRef(thread() || {})}
                </span>
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
                      class="btn h-6 px-2 text-xs"
                      data-variant="outline"
                      data-size="xs"
                      data-scope={scope}
                      aria-pressed={(thread()?.scope || 'pr') === scope}
                      disabled={scope === 'selection' && !thread()?.path}
                      onClick={() => void editor.actions.setThreadScope(scope)}
                    >
                      {scopeLabels[scope]}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </header>
          <textarea
            id="thr-input"
            ref={input}
            class="max-h-60 min-h-14"
            data-control="agent-input"
            aria-label="Thread message"
            rows="2"
            spellcheck={false}
            autocomplete="off"
            placeholder={
              thread()?.path
                ? 'Ask about this code, or ask for changes anywhere'
                : 'Ask about this workspace, or ask for changes'
            }
            value={editor.threads.state.message}
            onInput={(event) => editor.actions.setThreadMessage(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                void editor.actions.sendThread();
              }
              if (event.key === 'Escape') input?.blur();
            }}
          />
          <footer data-ui="thr-box-foot" data-align="block-end" class="gap-1">
            <div
              data-ui="agent-meta"
              class="flex min-w-0 items-center gap-1 in-[.queued]:hidden in-[.has-batch]:hidden"
            >
              <AgentPicker
                id="thr-agent"
                compact
                triggerClass="btn max-w-full h-7! text-foreground! border-transparent! bg-transparent! px-2! text-xs! shadow-none! hover:bg-accent!"
                disabled={editor.threads.running()}
              />
            </div>
            <span class="flex-1" />
            <button
              id="thr-send"
              class="btn rounded-full"
              data-control="agent-send"
              data-variant="primary"
              data-size="icon-sm"
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
              <span
                class={
                  editor.threads.running()
                    ? 'icon-[lucide--square] size-4'
                    : 'icon-[lucide--arrow-up] size-4'
                }
                aria-hidden="true"
              />
            </button>
          </footer>
        </div>
        <p data-ui="agent-hint" id="thr-hint" class="px-1 text-xs text-muted-foreground">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </section>
  );
}
