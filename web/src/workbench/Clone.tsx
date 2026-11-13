import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { PathInput } from './PathInput.tsx';

export function Clone(): JSX.Element {
  const { state, actions } = useWorkbench();
  const [path, setPath] = createSignal('');
  return (
    <section class="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header>
        <h2>No local clone of {state.clone?.repo} found</h2>
        <p class="text-sm text-muted-foreground">
          Pull requests open as git worktrees of one clone. Point faah at your clone, pick it in
          Browse, or let faah make one.
        </p>
      </header>
      <form
        class="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (path().trim()) actions.open(state.clone?.target || '', path().trim());
        }}
      >
        <PathInput
          value={path()}
          onInput={setPath}
          onFolder={actions.browse}
          label="Folder of your local clone"
          placeholder="~/path/to/your/clone"
        />
        <button class="btn">Use this clone</button>
      </form>
      <footer class="flex flex-wrap gap-2">
        <button class="btn" onClick={() => actions.open(state.clone?.target || '', 'managed')}>
          Let faah clone it
        </button>
        <span class="text-xs text-muted-foreground">
          into {state.clone?.managed}, once; later pull requests reuse it
        </span>
        <button class="btn" data-variant="ghost" onClick={actions.cancelClone}>
          Cancel
        </button>
      </footer>
    </section>
  );
}
