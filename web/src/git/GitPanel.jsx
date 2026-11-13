import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { SplitHandle } from '../lib/SplitHandle.jsx';
import { CommitRow } from './CommitRow.jsx';
import { CommitForm } from './CommitForm.jsx';
import { GitSyncMenu } from './GitSyncMenu.jsx';
import { GitNotice } from './GitNotice.jsx';
export function GitPanel() {
  const editor = useEditor();
  const git = editor.git;
  const meta = () => editor.store.state.workspace.meta;
  return (
    <Show when={meta()?.git}>
      <section
        id="git-panel"
        class="relative flex shrink-0 flex-col border-t"
        style={{ height: git.state.collapsed ? 'auto' : `${git.state.height}px` }}
      >
        <SplitHandle
          label="Git panel height"
          vertical
          value={-git.state.height}
          min={-700}
          max={-60}
          onChange={(value) => editor.actions.setGitPanelHeight(-value)}
        />
        <header class="flex items-center gap-2 border-b p-2 text-xs">
          <span id="git-branch" class="min-w-0 flex-1 truncate">
            {meta().pr?.head || editor.store.state.git.snapshot?.branch || meta().branch}
          </span>
          <span id="git-counts">{git.counts().label}</span>
          <button
            id="git-panel-collapse"
            class="btn"
            aria-label="Collapse Git panel"
            aria-expanded={!git.state.collapsed}
            onClick={() => editor.actions.setGitPanelCollapsed(!git.state.collapsed)}
          >
            ⌃
          </button>
        </header>
        <Show when={!git.state.collapsed}>
          <div id="git-panel-body" class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
            <Show when={meta().forge && !meta().forge.hasToken && !meta().pr}>
              <button
                id="git-token-nudge"
                class="btn"
                onClick={() => editor.actions.nudgeLegacyForgeToken()}
              >
                No {meta().forge.kind || 'forge'} token configured — add one
              </button>
            </Show>
            <GitNotice />
            <CommitForm />
            <Show when={!git.counts().hasChanges}>
              <p id="git-clean-state">Working tree clean</p>
            </Show>
            <GitSyncMenu />
            <div class="flex justify-between">
              <span>Recent Commits</span>
              <button
                id="git-see-all-commits"
                class="btn"
                onClick={() => void editor.actions.fetchRecentCommits(50)}
              >
                See all commits
              </button>
            </div>
            <Show when={git.state.commitsUrl}>
              <a href={git.state.commitsUrl} target="_blank" rel="noopener">
                View on forge
              </a>
            </Show>
            <div id="git-commits-list">
              <For each={git.recent()}>{(commit) => <CommitRow commit={commit} />}</For>
            </div>
          </div>
        </Show>
      </section>
    </Show>
  );
}
