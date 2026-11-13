import { createEffect, on, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { createShortcut } from '../lib/shortcuts.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.jsx';
import { AgentPicker } from './AgentPicker.jsx';
import { targetRef } from './logic.js';
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
      class="card gap-2 p-3"
      data-ui="agent-box"
      classList={{ busy: props.session.pending, queued: props.session.queued }}
    >
      <header class="flex items-center gap-2">
        <button
          class="btn min-w-0 flex-1 truncate font-mono text-xs"
          data-control="agent-ref"
          onClick={() =>
            editor.actions.openFile(props.session.target.path, { line: props.session.target.l1 })
          }
        >
          {targetRef(props.session.target)}
        </button>
        <button
          class="btn"
          aria-label="Close edit"
          data-control="agent-close"
          onClick={() => editor.actions.closeAgentEdit(props.session.id)}
        >
          ×
        </button>
      </header>
      <Show
        when={props.session.queued && !props.session.pending}
        fallback={
          <>
            <AgentPicker disabled={props.session.pending} />
            <textarea
              ref={input}
              aria-label="Edit instruction"
              data-control="agent-input"
              class="textarea"
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
                  if (props.session.pending) void editor.actions.cancelAgentEdit(props.session.id);
                  else editor.actions.closeAgentEdit(props.session.id);
                }
              }}
            />
            <div class="flex flex-wrap gap-1">
              <Show
                when={!props.session.pending}
                fallback={
                  <button
                    class="btn"
                    data-control="agent-cancel"
                    onClick={() => void editor.actions.cancelAgentEdit(props.session.id)}
                  >
                    Cancel
                  </button>
                }
              >
                <button
                  class="btn"
                  data-control="agent-send"
                  disabled={!props.session.instruction.trim()}
                  onClick={() => editor.actions.queueAgentEdit(props.session.id)}
                >
                  Add comment
                </button>
                <button
                  class="btn"
                  data-control="agent-now"
                  disabled={!props.session.instruction.trim()}
                  onClick={() => void editor.actions.applyAgentEdit(props.session.id)}
                >
                  Apply now
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
          </>
        }
      >
        <button
          class="btn justify-start whitespace-pre-wrap"
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
