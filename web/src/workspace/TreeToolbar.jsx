import { useEditor } from '../editor/context.jsx';
export function TreeToolbar() {
  const editor = useEditor();
  const tree = editor.tree;
  return (
    <header class="panel-head desktop:min-h-[var(--titlebar-h,2.5rem)] desktop:[-webkit-app-region:drag] desktop:[&_button]:[-webkit-app-region:no-drag] desktop:[&_a]:[-webkit-app-region:no-drag] desktop:[&_[role=group]]:[-webkit-app-region:no-drag] desktop:[&_[role=tab]]:[-webkit-app-region:no-drag] desktop:pl-[calc(0.75rem+var(--titlebar-left,0px))] desktop:flex-wrap desktop:pt-0 [&_.panel-actions]:desktop:w-[calc(100%+var(--titlebar-left,0px))] [&_.panel-actions]:desktop:-ml-[var(--titlebar-left,0px)] flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs font-medium">
      <span
        class="side-logo flex min-w-0 flex-1 items-center gap-2 overflow-hidden [&_img]:shrink-0 desktop:h-[var(--titlebar-h,38px)] [&_img]:h-4 [&_img]:w-auto"
        title="faah"
      >
        <img
          class="hidden dark:block"
          src="static/logo-dark.svg"
          alt="faah"
          width="35"
          height="13"
        />
        <img
          class="block dark:hidden"
          src="static/logo-light.svg"
          alt="faah"
          width="35"
          height="13"
        />
        <button
          id="st-ver"
          class="status-ver min-w-0 truncate cursor-pointer rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Keyboard shortcuts"
          onClick={() => editor.actions.showHelp()}
        >
          {editor.store.state.workspace.meta?.version
            ? 'v' + editor.store.state.workspace.meta.version
            : ''}
        </button>
      </span>
      <span class="panel-actions ml-auto flex shrink-0 items-center gap-1">
        <div class="button-group mr-1" role="group" aria-label="Explorer view mode">
          <button
            id="btn-files"
            class="btn"
            aria-pressed={tree.mode() === 'files'}
            data-variant={tree.mode() === 'files' ? 'secondary' : 'ghost'}
            onClick={() => void editor.actions.setTreeMode('files')}
            data-size="xs"
            data-control="view-choice"
          >
            <span class="icon-[lucide--folder] size-3 shrink-0" aria-hidden="true" />
            <span>Files</span>
          </button>
          <button
            id="btn-changed"
            class="btn"
            disabled={!tree.hasGitView()}
            aria-pressed={tree.mode() === 'git'}
            data-variant={tree.mode() === 'git' ? 'secondary' : 'ghost'}
            onClick={() => void editor.actions.setTreeMode('git')}
            data-size="xs"
            data-control="view-choice"
          >
            <span class="icon-[lucide--git-branch] size-3 shrink-0" aria-hidden="true" />
            <span>Diff</span>
          </button>
        </div>
        <button
          id="btn-new-file"
          class="btn ml-auto"
          aria-label="New File"
          title="New File"
          onClick={() => editor.actions.openNewItem('file')}
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[lucide--file-plus] size-3.5" />
        </button>
        <button
          id="btn-new-folder"
          class="btn"
          aria-label="New Folder"
          title="New Folder"
          onClick={() => editor.actions.openNewItem('dir')}
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[lucide--folder-plus] size-3.5" />
        </button>
        <button
          id="btn-collapse-tree"
          class="btn"
          aria-label="Collapse all folders"
          onClick={editor.actions.collapseTree}
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
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
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[lucide--chevrons-down] size-3.5" />
        </button>
        <button
          id="btn-reindex"
          class="btn"
          aria-label="Re-index"
          disabled={editor.store.state.workspace.reindexing}
          onClick={() => void editor.actions.reindexWorkspace()}
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[lucide--rotate-cw] size-3.5" />
        </button>
      </span>
    </header>
  );
}
