import { createEffect, on, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { createShortcut } from '../lib/shortcuts.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.jsx';
import { AgentPicker } from './AgentPicker.jsx';
import { targetRef } from './logic.ts';
export function AgentSession(props) {
  const editor = useEditor();
  let input;
  onMount(() => input?.focus());
  createEffect(
    on(
      () => editor.agents.state.focus.sequence,
      () => {
        if (editor.agents.state.focus.id === props.session.id) {
          input?.focus();
          input?.scrollIntoView({ block: 'nearest' });
        }
      },
      { defer: true },
    ),
  );
  createShortcut('Mod+Enter', () => void editor.actions.applyAgentEdit(props.session.id), {
    inputs: true,
    capture: true,
    when: () => document.activeElement === input,
  });
  return (
    <article
      class="card flex flex-col gap-2 p-4 [&.shake]:animate-pulse"
      data-ui="agent-box"
      classList={{ busy: props.session.pending, queued: props.session.queued }}
    >
      <div data-ui="agent-head" class="flex items-center gap-2 font-mono">
        <span class="sel-chip badge">Comment</span>
        <button
          class="btn"
          data-variant="ghost"
          data-size="xs"
          data-control="agent-ref"
          onClick={() =>
            editor.actions.openFile(props.session.target.path, { line: props.session.target.l1 })
          }
        >
          {targetRef(props.session.target)}
        </button>
        <span class="flex-1 min-w-0" />
        <button
          class="btn"
          data-variant="ghost"
          data-size="icon-xs"
          aria-label="Close edit"
          data-control="agent-close"
          onClick={() => editor.actions.closeAgentEdit(props.session.id)}
        >
          <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
      <Show
        when={props.session.queued && !props.session.pending}
        fallback={
          <>
            <div
              data-ui="agent-meta"
              class="flex flex-wrap items-center gap-2 in-[.queued]:hidden in-[.has-batch]:hidden"
            >
              <span data-ui="agent-meta-label" class="label flex-none text-muted-foreground">
                Model
              </span>
              <AgentPicker disabled={props.session.pending} />
            </div>
            <div data-ui="agent-compose" class="flex flex-col gap-2 in-[.queued]:hidden">
              <textarea
                ref={input}
                aria-label="Comment about selected code"
                rows="3"
                spellcheck={false}
                autocomplete="off"
                placeholder="Describe the change. Add it as a comment to batch with others, or apply it right away."
                data-control="agent-input"
                class="textarea resize-y"
                value={props.session.instruction}
                disabled={props.session.pending}
                onInput={(event) =>
                  editor.actions.setAgentInstruction(props.session.id, event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.isComposing
                  ) {
                    event.preventDefault();
                    editor.actions.queueAgentEdit(props.session.id);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    if (props.session.pending)
                      void editor.actions.cancelAgentEdit(props.session.id);
                    else editor.actions.closeAgentEdit(props.session.id);
                  }
                }}
              />
              <div
                data-ui="agent-foot"
                class="flex items-center gap-2 font-mono text-muted-foreground"
              >
                <span data-ui="agent-hint" class="flex-1">
                  Enter to send, Esc to cancel
                </span>
                <Show
                  when={!props.session.pending}
                  fallback={
                    <button
                      class="btn"
                      data-variant="outline"
                      data-size="xs"
                      data-control="agent-cancel"
                      onClick={() => void editor.actions.cancelAgentEdit(props.session.id)}
                    >
                      Cancel
                    </button>
                  }
                >
                  <button
                    class="btn"
                    data-variant="outline"
                    data-size="xs"
                    data-control="agent-now"
                    disabled={!props.session.instruction.trim()}
                    onClick={() => void editor.actions.applyAgentEdit(props.session.id)}
                  >
                    Apply now
                  </button>
                  <button
                    class="btn"
                    data-control="agent-send"
                    data-variant="primary"
                    data-size="xs"
                    disabled={!props.session.instruction.trim()}
                    onClick={() => editor.actions.queueAgentEdit(props.session.id)}
                  >
                    Add comment
                  </button>
                </Show>
                <Show when={props.session.threadId}>
                  <button
                    class="btn"
                    onClick={() => void editor.actions.openThread(props.session.threadId)}
                  >
                    View thread
                  </button>
                </Show>
              </div>
            </div>
          </>
        }
      >
        <button
          class="btn"
          data-variant="outline"
          data-size="xs"
          data-control="agent-queued"
          onClick={() => editor.actions.queueAgentEdit(props.session.id, false)}
        >
          {props.session.instruction}
        </button>
      </Show>
      <Show when={props.session.pending}>
        <p role="status">Editing · {Math.round((props.session.job?.ms || 0) / 1000)}s</p>
      </Show>
      <ErrorNotice
        error={props.session.error}
        streams={[
          ['stderr', props.session.job?.stderr],
          ['stdout', props.session.job?.stdout || props.session.job?.log],
        ]}
      >
        <Show when={props.session.error.includes('already running')}>
          <button class="btn" onClick={() => void editor.actions.cancelAgentJob(0)}>
            Cancel in-flight edit
          </button>
        </Show>
      </ErrorNotice>
    </article>
  );
}
