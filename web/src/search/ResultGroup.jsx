import { createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { displayPath } from './logic.ts';
export function ResultGroup(props) {
  const editor = useEditor();
  const [collapsed, setCollapsed] = createSignal(false);
  async function open(match) {
    await editor.actions.openFile(props.file.path, { line: match.line });
    editor.actions.flashFind?.(match.mid || props.query);
  }
  return (
    <section>
      <button
        class="btn flex w-full justify-start text-xs"
        data-ui="rfile"
        aria-expanded={!collapsed()}
        title={props.file.path}
        onClick={() => setCollapsed(!collapsed())}
      >
        {displayPath(props.file.path)}{' '}
        <span class="badge ml-auto">{props.file.matches.length}</span>
      </button>
      <Show when={!collapsed()}>
        <For each={props.file.matches}>
          {(match) => (
            <button
              class="flex w-full min-w-0 gap-2 p-2 text-left font-mono text-xs hover:bg-accent"
              data-ui="rline"
              title={`Jump to ${props.file.path}:${match.line}`}
              onClick={() => void open(match)}
            >
              <span class="w-10 shrink-0 text-right">{match.line}</span>
              <span class="min-w-0 truncate">
                {match.pre}
                <mark>{match.mid || props.query}</mark>
                {match.post}
              </span>
            </button>
          )}
        </For>
      </Show>
    </section>
  );
}
