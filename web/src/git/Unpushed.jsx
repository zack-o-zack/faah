import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { SplitHandle } from '../lib/SplitHandle.jsx';
import { CommitRow } from './CommitRow.jsx';
export function Unpushed() {
  const editor = useEditor();
  const git = editor.git;
  let panel;
  return (
    <Show when={editor.tree.mode() === 'git' && git.state.unpushed.length}>
      <section
        id="unpushed"
        ref={panel}
        class="unpushed relative flex min-h-8 max-h-[45vh] flex-col border-t bg-sidebar [&.collapsed]:flex-none [&.collapsed_.unpushed-body]:hidden"
        classList={{ collapsed: git.state.unpushedCollapsed }}
        style={{
          height:
            !git.state.unpushedCollapsed && git.state.unpushedHeight
              ? `${git.state.unpushedHeight}px`
              : undefined,
        }}
      >
        <SplitHandle
          label="Unpushed panel height"
          vertical
          class="unpushed-resizer absolute -top-1 inset-x-0 z-10 h-2 cursor-row-resize hover:bg-primary [&.drag]:bg-primary"
          value={-(git.state.unpushedHeight || panel?.offsetHeight || 82)}
          min={-600}
          max={-60}
          onChange={(value) => editor.actions.setUnpushedHeight(-value)}
        />
        <div class="unpushed-head flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <span
            class="icon-[lucide--arrow-up] size-3.5 shrink-0 unpushed-icon text-primary"
            aria-hidden="true"
          />
          <span class="unpushed-title shrink-0 text-xs font-medium text-muted-foreground">
            {editor.store.state.workspace.meta?.pr ? 'Your commits' : 'Unpushed'}
          </span>
          <span
            id="unpushed-count"
            class="badge empty:hidden"
            data-variant="secondary"
            data-control="unpushed-count"
          >
            {git.state.unpushed.length}
          </span>
          <span class="flex-1 min-w-0" />
          <span
            id="unpushed-upstream"
            class="unpushed-upstream max-w-[45%] truncate font-mono text-xs text-muted-foreground"
          >
            {git.state.upstream}
          </span>
          <button
            id="unpushed-collapse"
            class="btn"
            data-control="pr-comments-collapse"
            data-variant="ghost"
            data-size="icon-xs"
            aria-label="Collapse unpushed commits"
            onClick={() => editor.actions.setUnpushedCollapsed(!git.state.unpushedCollapsed)}
          >
            <span class="icon-[lucide--chevron-down] size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>
        <Show when={!git.state.unpushedCollapsed}>
          <div id="unpushed-body" class="unpushed-body min-h-0 flex-1 overflow-y-auto py-2">
            <For each={git.state.unpushed}>
              {(commit) => <CommitRow commit={commit} unpushed />}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  );
}
