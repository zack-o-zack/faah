import { createMemo, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ContextMenu } from '../lib/ContextMenu.tsx';
import { fileKind } from './tree-logic.ts';
export function TreeRow(props) {
  const editor = useEditor();
  const decoration = createMemo(() => editor.tree.decoration(props.row));
  const open = () =>
    props.row.dir
      ? void editor.actions.toggleTreeDirectory(props.row.path)
      : void editor.actions.openTreeFile(props.row.path);
  return (
    <ContextMenu
      label="File actions"
      menu={
        <>
          <Show when={props.row.dir}>
            <button
              class="w-full justify-start"
              data-control="sel-menu-item"
              data-variant="ghost"
              data-size="xs"
              role="menuitem"
              onClick={() => editor.actions.openNewItem('file', props.row.path)}
            >
              <span>New File...</span>
            </button>
            <button
              class="w-full justify-start"
              data-control="sel-menu-item"
              data-variant="ghost"
              data-size="xs"
              role="menuitem"
              onClick={() => editor.actions.openNewItem('dir', props.row.path)}
            >
              <span>New Folder...</span>
            </button>
          </Show>
          <button
            class="w-full justify-start"
            data-control="sel-menu-item"
            data-variant="ghost"
            data-size="xs"
            role="menuitem"
            onClick={() => void editor.actions.copyTreePath(props.row.path, 'relative')}
          >
            <span>Copy Relative Path</span>
          </button>
          <button
            class="w-full justify-start"
            data-control="sel-menu-item"
            data-variant="ghost"
            data-size="xs"
            role="menuitem"
            onClick={() => void editor.actions.copyTreePath(props.row.path, 'name')}
          >
            <span>{props.row.dir ? 'Copy Folder Name' : 'Copy File Name'}</span>
          </button>
          <button
            class="w-full justify-start"
            data-control="sel-menu-item"
            data-variant="ghost"
            data-size="xs"
            role="menuitem"
            onClick={() => void editor.actions.copyTreePath(props.row.path, 'absolute')}
          >
            <span>Copy Absolute Path</span>
          </button>
        </>
      }
    >
      {(menu) => (
        <div
          class="tr flex min-h-6 cursor-pointer select-none items-center gap-1.5 pr-2 text-xs whitespace-nowrap hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-ring [&.sel]:bg-sidebar-accent [&.ignored]:opacity-50 [&.git-M]:text-primary-text [&.git-R]:text-primary-text [&.git-A]:text-gi [&.git-untracked]:text-gi [&.git-D]:text-gd [&.git-D_.nm]:line-through [&.your-change]:font-semibold [.scope-pr_&.your-change]:font-normal [&.file-viewed_.nm]:opacity-50 group"
          classList={{
            dir: !!props.row.dir,
            file: !props.row.dir,
            open: editor.tree.expanded(props.row.path),
            sel: editor.tree.state.reveal.path === props.row.path,
            ignored: !!props.row.ignored,
            dirty: decoration().dirty,
            'your-change': !!decoration().yours,
            'git-M': decoration().code === 'M',
            'git-D': decoration().code === 'D',
            'git-A': decoration().code === 'A',
            'git-untracked': decoration().code === 'U',
            'is-staged': decoration().staged,
            'file-viewed': decoration().viewed,
          }}
          id={'tree-item-' + encodeURIComponent(props.row.path)}
          role="treeitem"
          aria-level={props.row.depth + 1}
          aria-expanded={props.row.dir ? editor.tree.expanded(props.row.path) : undefined}
          aria-selected={editor.tree.state.reveal.path === props.row.path}
          data-path={props.row.path}
          data-dir={props.row.dir ? props.row.path : undefined}
          data-file={!props.row.dir ? props.row.path : undefined}
          title={(props.row.dir ? 'Folder: ' : 'Open ') + props.row.path}
          style={{ 'padding-left': `${8 + props.row.depth * 12 + (props.row.dir ? 0 : 12)}px` }}
          onClick={open}
        >
          <Show
            when={props.row.dir}
            fallback={
              <span
                class="ic size-2 shrink-0 rounded-sm bg-faint [--dot:var(--faint)] data-[t=code]:bg-[var(--nf)] data-[t=data]:bg-[var(--kt)] data-[t=web]:bg-[var(--nt)] data-[t=img]:bg-[var(--nc)]"
                data-t={fileKind(props.row.name)}
              />
            }
          >
            <span
              data-ui="ar"
              class="shrink-0 text-muted-foreground size-2 border-r border-t border-muted-foreground rotate-45 group-[.open]:rotate-[135deg]"
            />
          </Show>
          <button
            class="nm min-h-6 min-w-6 text-left focus-visible:outline focus-visible:outline-ring truncate group-[.dir.dirty]:after:ml-1 group-[.dir.dirty]:after:inline-block group-[.dir.dirty]:after:size-1 group-[.dir.dirty]:after:rounded-full group-[.dir.dirty]:after:bg-primary"
            tabindex="-1"
          >
            {props.row.name}
          </button>
          <span class="ml-auto flex shrink-0 items-center gap-0.5">
            <Show when={!props.row.dir && decoration().code}>
              <span class="gs w-3 text-center font-mono">{decoration().code}</span>
            </Show>
            <Show when={!props.row.dir && decoration().yours}>
              <span class="text-primary" title="Your change">
                YOU
              </span>
            </Show>
            <Show when={!props.row.dir && decoration().showStage}>
              <label
                class="flex size-6 shrink-0 items-center justify-center"
                data-stage-target
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  class="input"
                  aria-label="Stage file"
                  data-stage={props.row.path}
                  data-partial={!!decoration().partial}
                  checked={decoration().staged}
                  prop:indeterminate={!!decoration().partial}
                  disabled={!!editor.tree.state.staging[props.row.path]}
                  title={
                    decoration().partial
                      ? 'Changed after staging — click to stage the latest copy'
                      : 'Stage or unstage file'
                  }
                  onChange={(event) =>
                    void editor.actions.stageTreeFile(
                      props.row.path,
                      decoration().partial || event.currentTarget.checked,
                    )
                  }
                />
              </label>
            </Show>
            <button
              class="btn shrink-0 ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-[.sel]:opacity-100"
              data-control="tr-menu-btn"
              data-variant="ghost"
              data-size="icon-xs"
              aria-label="Actions"
              onClick={menu.open}
            >
              <span class="icon-[lucide--ellipsis] size-3 shrink-0" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
    </ContextMenu>
  );
}
