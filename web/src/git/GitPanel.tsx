import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { SplitHandle } from '../lib/SplitHandle.tsx';
import { CommitRow } from './CommitRow.tsx';
import { CommitForm } from './CommitForm.tsx';
import { GitSyncMenu } from './GitSyncMenu.tsx';
import { GitNotice } from './GitNotice.tsx';
export function GitPanel(): JSX.Element {
  const editor = useEditor();
  const git = editor.git;
  const meta = () => editor.store.state.workspace.meta;
  return (
    <Show when={meta()?.git}>
      <section
        id="git-panel"
        class="git-panel relative flex h-96 min-h-8 max-h-[80vh] shrink-0 flex-col border-t bg-sidebar [&.collapsed]:h-auto! [&.collapsed_.git-panel-body]:hidden"
        classList={{ collapsed: git.state.collapsed }}
        style={{ height: git.state.collapsed ? 'auto' : `${git.state.height}px` }}
      >
        <SplitHandle
          label="Git panel height"
          vertical
          class="git-panel-resizer absolute -top-1 inset-x-0 z-10 h-2 cursor-row-resize hover:bg-primary [&.drag]:bg-primary"
          value={-git.state.height}
          min={-700}
          max={-60}
          onChange={(value) => editor.actions.setGitPanelHeight(-value)}
        />
        <div class="git-panel-head flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <span
            class="icon-[lucide--git-branch] size-3.5 shrink-0 git-panel-icon text-primary"
            title="Git Panel"
            aria-hidden="true"
          />
          <span id="git-branch" class="git-branch truncate font-medium">
            {meta()?.pr
              ? `${meta()?.pr?.head} (PR review)`
              : editor.store.state.git.snapshot?.branch}
          </span>
          <span id="git-counts" class="git-counts shrink-0 font-mono text-xs text-muted-foreground">
            {git.counts().changed ? git.counts().label : ''}
          </span>
          <span class="flex-1 min-w-0" />
          <button
            id="git-panel-collapse"
            class="btn"
            data-control="pr-comments-collapse"
            data-variant="ghost"
            data-size="icon-xs"
            aria-label="Collapse Git panel"
            onClick={() => editor.actions.setGitPanelCollapsed(!git.state.collapsed)}
          >
            <span class="icon-[lucide--chevron-down] size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>
        <Show when={!git.state.collapsed}>
          <div
            id="git-panel-body"
            class="git-panel-body flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
          >
            <Show when={meta()?.forge && !meta()?.forge?.hasToken && !meta()?.pr}>
              <button
                id="git-token-nudge"
                class="btn"
                data-control="git-token-nudge"
                data-variant="outline"
                data-size="xs"
                onClick={() => editor.actions.openForgeConnect()}
              >
                <span class="icon-[lucide--circle-alert] size-3 shrink-0" aria-hidden="true" />
                <span>No forge token configured — add one</span>
              </button>
            </Show>
            <GitNotice />
            <CommitForm />
            <div id="git-action-row" class="flex items-stretch gap-2">
              <Show
                when={git.counts().hasChanges}
                fallback={
                  <div
                    id="git-clean-state"
                    class="git-clean-state flex min-w-0 flex-1 items-center justify-center gap-2 rounded border border-dashed px-3 py-1.5 text-xs text-muted-foreground [&_svg]:shrink-0 [&_svg]:text-primary"
                  >
                    <span class="icon-[lucide--check] size-3.5 shrink-0" aria-hidden="true" />
                    <span>Working tree clean</span>
                  </div>
                }
              >
                <button
                  id="git-commit"
                  type="button"
                  class="btn min-w-0 flex-1"
                  data-variant="primary"
                  data-size="sm"
                  disabled={!!git.state.pending}
                  onClick={() => void editor.actions.commit()}
                >
                  <span
                    data-ui="icon"
                    class="icon-[lucide--sparkle] size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span data-ui="label">{git.state.pending || 'Commit'}</span>
                </button>
              </Show>
              <GitSyncMenu />
            </div>
            <div
              id="git-recent-commits"
              class="git-recent-commits mt-1 flex flex-col gap-1 border-t pt-2"
            >
              <div class="git-recent-head flex items-center justify-between">
                <span class="git-recent-title shrink-0 text-xs font-medium text-muted-foreground">
                  Recent Commits
                </span>
                <a
                  id="git-see-all-commits"
                  class="btn"
                  data-variant="ghost"
                  data-size="icon-xs"
                  href={git.state.commitsUrl || '#'}
                  target="_blank"
                  rel="noopener"
                  title="See all commits"
                  aria-label="See all commits"
                  onClick={(event) => {
                    if (!git.state.commitsUrl) {
                      event.preventDefault();
                      void editor.actions.fetchRecentCommits(50);
                    }
                  }}
                >
                  <span class="icon-[lucide--external-link] size-3.5 shrink-0" aria-hidden="true" />
                </a>
              </div>
              <div id="git-commits-list" class="git-commits-list flex flex-col gap-1">
                <For each={git.recent()}>{(commit) => <CommitRow commit={commit} />}</For>
              </div>
            </div>
          </div>
        </Show>
      </section>
    </Show>
  );
}
