import { createResource, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
export function AgentChoice() {
  const editor = useEditor();
  const meta = () => editor.store.state.workspace.meta;
  const [models] = createResource(
    () => meta()?.agent || false,
    (name) => editor.actions.legacyAgentModels(name),
  );
  return (
    <div class="flex min-w-0 gap-1">
      <select
        class="select min-w-0"
        aria-label="Coding harness"
        value={meta()?.agent || ''}
        onChange={(event) => void editor.actions.selectLegacyAgent(event.currentTarget.value, '')}
      >
        <option value="">Choose harness</option>
        <For each={(meta()?.agents || []).filter((agent) => agent.installed)}>
          {(agent) => <option value={agent.name}>{agent.name}</option>}
        </For>
      </select>
      <Show when={!models.error && models()?.length}>
        <select
          class="select min-w-0"
          aria-label="Agent model"
          value={meta()?.agentModel || ''}
          onChange={(event) =>
            void editor.actions.selectLegacyAgent(meta().agent, event.currentTarget.value)
          }
        >
          <For each={models()}>{(model) => <option value={model}>{model}</option>}</For>
        </select>
      </Show>
    </div>
  );
}
