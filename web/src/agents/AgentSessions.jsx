import { For, Show, onMount, onCleanup } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { AgentSession } from './AgentSession.jsx';
import { AgentPicker } from './AgentPicker.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.jsx';
import { createShortcut, Kbd } from '../lib/shortcuts.jsx';
export function AgentSessions() {
  const editor = useEditor();
  const agents = editor.agents;
  onMount(() => {
    const beforeUnload = (event) => {
      if (!agents.state.batch.pending && !agents.state.sessions.some((session) => session.pending))
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    onCleanup(() => window.removeEventListener('beforeunload', beforeUnload));
  });
  createShortcut('Mod+Shift+Enter', () => void editor.actions.applyAgentBatch(), {
    inputs: true,
    when: () => !!agents.state.sessions.length,
    capture: true,
    stopPropagation: true,
  });
  return (
    <Show when={agents.state.sessions.length || agents.state.batch.pending}>
      <section
        id="agentbox"
        class="flex max-h-[55%] shrink-0 flex-col gap-2 overflow-auto border-b p-3"
      >
        <div id="agent-batch-bar" class="card gap-2 p-2">
          <div class="flex items-center justify-between">
            <span id="agent-batch-count">{agents.ready().length} comments</span>
            <button
              id="agent-batch-clear"
              class="btn"
              disabled={agents.state.batch.pending}
              onClick={editor.actions.clearAgentEdits}
            >
              Clear all
            </button>
          </div>
          <AgentPicker disabled={agents.state.batch.pending} />
          <Show
            when={agents.state.batch.pending}
            fallback={
              <button
                id="agent-batch-apply"
                class="btn"
                disabled={!agents.ready().length}
                onClick={() => void editor.actions.applyAgentBatch()}
              >
                Apply all <Kbd combo="Mod+Shift+Enter" />
              </button>
            }
          >
            <button
              id="agent-batch-cancel"
              class="btn"
              onClick={() => void editor.actions.cancelAgentBatch()}
            >
              Cancel batch
            </button>
          </Show>
          <Show when={agents.state.batch.threadId}>
            <button
              class="btn"
              onClick={() => void editor.actions.openThread(agents.state.batch.threadId)}
            >
              View batch thread
            </button>
          </Show>
          <ErrorNotice error={agents.state.batch.error} />
        </div>
        <div id="agentbox-list" class="flex flex-col gap-2">
          <For each={agents.state.sessions}>{(session) => <AgentSession session={session} />}</For>
        </div>
      </section>
    </Show>
  );
}
