import { useEditor } from '../editor/context.jsx';
export function TreeToolbar() {
  const editor = useEditor();
  const tree = editor.tree;
  return (
    <header class="panel-head flex shrink-0 items-center gap-2 border-b p-2">
      <span class="side-logo flex min-w-0 flex-1 items-center gap-2" title="faah">
        <img class="hidden dark:block h-4" src="static/logo-dark.svg" alt="faah" />
        <img class="block dark:hidden h-4" src="static/logo-light.svg" alt="faah" />
        <button
          id="st-ver"
          class="btn font-mono text-xs"
          title="Keyboard shortcuts"
          onClick={() => editor.services.showHelp?.()}
        >
          {editor.store.state.workspace.meta?.version
            ? 'v' + editor.store.state.workspace.meta.version
            : ''}
        </button>
      </span>
      <div class="button-group" role="group" aria-label="Explorer view mode">
        <button
          id="btn-files"
          class="btn"
          aria-pressed={tree.mode() === 'files'}
          onClick={() => void editor.actions.setTreeMode('files')}
        >
          Files
        </button>
        <button
          id="btn-changed"
          class="btn"
          disabled={!tree.hasGitView()}
          aria-pressed={tree.mode() === 'git'}
          onClick={() => void editor.actions.setTreeMode('git')}
        >
          Diff
        </button>
      </div>
      <button
        id="btn-new-file"
        class="btn"
        aria-label="New File"
        title="New File"
        onClick={() => editor.actions.openNewItem('file')}
      >
        <span class="icon-[lucide--file-plus] size-3.5" />
      </button>
      <button
        id="btn-new-folder"
        class="btn"
        aria-label="New Folder"
        title="New Folder"
        onClick={() => editor.actions.openNewItem('dir')}
      >
        <span class="icon-[lucide--folder-plus] size-3.5" />
      </button>
      <button
        id="btn-collapse-tree"
        class="btn"
        aria-label="Collapse all folders"
        onClick={editor.actions.collapseTree}
      >
        <span class="icon-[lucide--chevrons-up] size-3.5" />
      </button>
      <button
        id="btn-expand-tree"
        class="btn"
        classList={{ busy: tree.state.busy }}
        aria-busy={tree.state.busy}
        aria-label={tree.state.busy ? 'Expanding project folders' : 'Expand all project folders'}
        onClick={() => void editor.actions.expandTree()}
      >
        <span class="icon-[lucide--chevrons-down] size-3.5" />
      </button>
      <button id="btn-reindex" class="btn" aria-label="Re-index">
        <span class="icon-[lucide--rotate-cw] size-3.5" />
      </button>
    </header>
  );
}
