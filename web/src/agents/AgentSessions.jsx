import { For, Show, onMount, onCleanup } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { AgentSession } from './AgentSession.jsx';
import { AgentPicker } from './AgentPicker.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { createShortcut } from '../lib/shortcuts.tsx';
import { AGENT_HELP } from '../shortcuts/help.ts';
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
  onCleanup(editor.shortcuts.describe(AGENT_HELP));
  return (
    <Show when={agents.state.sessions.length || agents.state.batch.pending}>
      <section
        id="agentbox"
        class="flex shrink-0 max-h-[55%] flex-col gap-2 overflow-y-auto border-b bg-sidebar p-3"
        classList={{ 'has-batch': agents.state.sessions.length >= 1 }}
      >
        <div id="agent-batch-bar" data-ui="agent-batch-bar" class="card flex flex-col gap-2 p-3">
          <div data-ui="agent-batch-header" class="flex flex-col gap-2">
            <div data-ui="agent-batch-title-row" class="flex items-center gap-2 font-mono">
              <span class="badge" data-variant="secondary" data-control="agent-batch-badge">
                Batch
              </span>
              <span id="agent-batch-count" data-ui="agent-batch-count" class="font-mono">
                {agents.ready().length
                  ? `${agents.ready().length} ${agents.ready().length === 1 ? 'comment' : 'comments'} in batch`
                  : 'No comments yet'}
              </span>
              <span class="flex-1 min-w-0" />
              <button
                id="agent-batch-clear"
                class="btn"
                data-control="agent-batch-clear"
                data-variant="outline"
                data-size="xs"
                disabled={agents.state.batch.pending}
                onClick={editor.actions.clearAgentEdits}
              >
                Clear All
              </button>
            </div>
            <div data-ui="agent-batch-meta" class="flex items-center gap-2 p-3">
              <span data-ui="agent-meta-label" class="label flex-none text-muted-foreground">
                Model
              </span>
              <AgentPicker id="agent-batch-agent" disabled={agents.state.batch.pending} />
            </div>
          </div>
          <div
            data-ui="agent-batch-actions"
            class="flex items-center gap-2 font-mono text-muted-foreground"
          >
            <span id="agent-batch-hint" data-ui="agent-hint" class="flex-1">
              {agents.ready().length
                ? 'Select more code to add more'
                : 'Write a comment, then press Enter to add it'}
            </span>
            <Show
              when={agents.state.batch.pending}
              fallback={
                <button
                  id="agent-batch-apply"
                  class="btn"
                  data-control="agent-send agent-batch-apply"
                  data-variant="primary"
                  data-size="xs"
                  disabled={!agents.ready().length}
                  onClick={() => void editor.actions.applyAgentBatch()}
                >
                  {agents.ready().length === 1
                    ? 'Apply comment'
                    : `Apply all${agents.ready().length ? ' (' + agents.ready().length + ')' : ''}`}
                </button>
              }
            >
              <button
                id="agent-batch-cancel"
                class="btn"
                data-control="agent-cancel"
                data-variant="outline"
                data-size="xs"
                onClick={() => void editor.actions.cancelAgentBatch()}
              >
                Cancel
              </button>
            </Show>
          </div>
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
