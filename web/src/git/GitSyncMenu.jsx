import { useEditor } from '../editor/context.jsx';
import { DropdownMenu } from '../lib/DropdownMenu.jsx';
export function GitSyncMenu() {
  const editor = useEditor();
  return (
    <div class="flex gap-1" id="git-sync-group">
      <button
        id="git-sync"
        class="btn"
        disabled={!!editor.git.state.pending}
        onClick={() => void editor.actions.syncGit()}
      >
        Sync {editor.store.state.git.snapshot?.behind || 0}↓{' '}
        {editor.store.state.git.snapshot?.ahead || 0}↑
      </button>
      <DropdownMenu label="Sync actions">
        <button
          role="menuitem"
          class="btn w-full"
          disabled={!!editor.git.state.pending}
          onClick={() => void editor.actions.syncGit()}
        >
          git sync
        </button>
        <button
          id="git-pull"
          role="menuitem"
          class="btn w-full"
          disabled={!!editor.git.state.pending}
          onClick={() => void editor.actions.pullGit()}
        >
          git pull
        </button>
        <button
          id="git-push"
          role="menuitem"
          class="btn w-full"
          disabled={!!editor.git.state.pending || !editor.store.state.git.snapshot?.ahead}
          onClick={() => void editor.actions.pushGit()}
        >
          git push
        </button>
      </DropdownMenu>
    </div>
  );
}
