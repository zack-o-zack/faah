import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { SplitHandle } from '../lib/SplitHandle.jsx';
import { CommitRow } from './CommitRow.jsx';
export function Unpushed() {
  const editor = useEditor();
  const git = editor.git;
  return (
    <Show when={editor.tree.mode() === 'git' && git.state.unpushed.length}>
      <section
        id="unpushed"
        class="relative flex shrink-0 flex-col border-t"
        style={{ height: git.state.unpushedCollapsed ? 'auto' : `${git.state.unpushedHeight}px` }}
      >
        <SplitHandle
          label="Unpushed panel height"
          vertical
          value={-git.state.unpushedHeight}
          min={-600}
          max={-60}
          onChange={(value) => editor.actions.setUnpushedHeight(-value)}
        />
        <header class="flex items-center gap-2 p-2 text-xs">
          <span>Unpushed</span>
          <span id="unpushed-count">{git.state.unpushed.length}</span>
          <span class="min-w-0 flex-1 truncate">{git.state.upstream}</span>
          <button
            class="btn"
            aria-label="Collapse unpushed commits"
            aria-expanded={!git.state.unpushedCollapsed}
            onClick={() => editor.actions.setUnpushedCollapsed(!git.state.unpushedCollapsed)}
          >
            ⌃
          </button>
        </header>
        <Show when={!git.state.unpushedCollapsed}>
          <div id="unpushed-body" class="min-h-0 overflow-auto">
            <For each={git.state.unpushed}>{(commit) => <CommitRow commit={commit} />}</For>
          </div>
        </Show>
      </section>
    </Show>
  );
}
