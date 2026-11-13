import { createMemo, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ContextMenu } from '../lib/ContextMenu.jsx';
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
              class="btn w-full"
              role="menuitem"
              onClick={() => editor.actions.openNewItem('file', props.row.path)}
            >
              New File…
            </button>
            <button
              class="btn w-full"
              role="menuitem"
              onClick={() => editor.actions.openNewItem('dir', props.row.path)}
            >
              New Folder…
            </button>
          </Show>
          <button
            class="btn w-full"
            role="menuitem"
            onClick={() => void editor.actions.copyTreePath(props.row.path, 'relative')}
          >
            Copy Relative Path
          </button>
          <button
            class="btn w-full"
            role="menuitem"
            onClick={() => void editor.actions.copyTreePath(props.row.path, 'name')}
          >
            Copy Name
          </button>
          <button
            class="btn w-full"
            role="menuitem"
            onClick={() => void editor.actions.copyTreePath(props.row.path, 'absolute')}
          >
            Copy Absolute Path
          </button>
        </>
      }
    >
      {(menu) => (
        <div
          class="tr group flex h-6 items-center gap-1.5 whitespace-nowrap pr-2 text-xs hover:bg-sidebar-accent"
          classList={{
            dir: !!props.row.dir,
            file: !props.row.dir,
            open: editor.tree.expanded(props.row.path),
            sel: editor.active()?.path === props.row.path,
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
          aria-selected={editor.active()?.path === props.row.path}
          data-path={props.row.path}
          data-dir={props.row.dir ? props.row.path : undefined}
          data-file={!props.row.dir ? props.row.path : undefined}
          title={(props.row.dir ? 'Folder: ' : 'Open ') + props.row.path}
          style={{ 'padding-left': `${8 + props.row.depth * 12}px` }}
          onClick={open}
        >
          <Show
            when={props.row.dir}
            fallback={
              <span
                class="ic size-2 shrink-0 rounded-sm bg-faint"
                data-t={fileKind(props.row.name)}
              />
            }
          >
            <span
              class="icon-[lucide--chevron-right] size-3 shrink-0"
              classList={{ 'rotate-90': editor.tree.expanded(props.row.path) }}
            />
          </Show>
          <button class="nm min-w-0 flex-1 truncate text-left" tabindex="-1">
            {props.row.name}
          </button>
          <Show when={!props.row.dir && decoration().code}>
            <span class="gs font-mono">{decoration().code}</span>
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
            class="btn opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label="Actions"
            onClick={menu.open}
          >
            <span class="icon-[lucide--ellipsis] size-3.5" />
          </button>
        </div>
      )}
    </ContextMenu>
  );
}
