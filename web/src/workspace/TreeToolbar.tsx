import { TabRail } from '../lib/TabRail.tsx';
import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Brand } from '../brand/Brand.tsx';
export function TreeToolbar(): JSX.Element {
  const editor = useEditor();
  const tree = editor.tree;
  return (
    <header class="panel-head desktop:min-h-[var(--titlebar-h,2.5rem)] desktop:[-webkit-app-region:drag] desktop:[&_button]:[-webkit-app-region:no-drag] desktop:[&_a]:[-webkit-app-region:no-drag] desktop:[&_[role=group]]:[-webkit-app-region:no-drag] desktop:[&_[role=tab]]:[-webkit-app-region:no-drag] desktop:pl-[calc(0.75rem+var(--titlebar-left,0px))] desktop:pt-0 [&_.panel-actions]:desktop:w-[calc(100%+var(--titlebar-left,0px))] [&_.panel-actions]:desktop:-ml-[var(--titlebar-left,0px)] flex flex-wrap shrink-0 items-center gap-1 border-b px-3 py-2 text-xs font-medium">
      <span
        class="side-logo flex shrink-0 items-center gap-2 desktop:h-[var(--titlebar-h,38px)]"
        title="fibo"
      >
        <Brand />
        <button
          id="st-ver"
          class="status-ver shrink-0 whitespace-nowrap cursor-pointer rounded-sm px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Keyboard shortcuts"
          onClick={() => editor.actions.showHelp()}
        >
          {editor.store.state.workspace.meta?.version
            ? 'v' + editor.store.state.workspace.meta.version
            : ''}
        </button>
      </span>
      <span class="panel-actions ml-auto flex min-w-0 flex-wrap items-center gap-1">
        <TabRail label="Explorer view mode" size="xs">
          <button
            id="btn-files"
            role="tab"
            aria-controls="tree-panel"
            tabindex={tree.mode() === 'files' ? 0 : -1}
            aria-selected={tree.mode() === 'files'}
            onClick={() => void editor.actions.setTreeMode('files')}
            data-control="view-choice"
          >
            <span class="icon-[ph--folder] shrink-0" aria-hidden="true" />
            <span>Files</span>
          </button>
          <button
            id="btn-changed"
            role="tab"
            aria-controls="tree-panel"
            tabindex={tree.mode() === 'git' ? 0 : -1}
            aria-selected={tree.mode() === 'git'}
            onClick={() => void editor.actions.setTreeMode('git')}
            data-control="view-choice"
          >
            <span class="icon-[ph--git-branch] shrink-0" aria-hidden="true" />
            <span>Diff</span>
          </button>
        </TabRail>
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
          <span class="icon-[ph--file-plus]" />
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
          <span class="icon-[ph--folder-plus]" />
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
          <span class="icon-[ph--caret-double-up]" />
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
          <span class="icon-[ph--caret-double-down]" />
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
          <span class="icon-[ph--arrow-clockwise]" />
        </button>
      </span>
    </header>
  );
}
