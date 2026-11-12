import { Show } from 'solid-js';
import { useEditor } from './context.jsx';
import { EditControls } from './EditControls.jsx';
import { canDiff, previewKind, viewMode } from '../viewers/view.js';
import { withKeys } from '../lib/keyboard.js';

export function FileActions() {
  const editor = useEditor();
  const actions = editor.actions;
  const document = editor.active;
  const kind = () => previewKind(document());
  const preview = () => ['markdown', 'table'].includes(viewMode(document()));
  function source() {
    const line = document()?.diffMode
      ? editor.services.diff?.currentLine()
      : editor.services.preview?.topLine();
    actions.setView(document(), 'source');
    if (line) {
      editor.actions.patch({ cur: line });
      editor.actions.centerLine(line);
    }
  }
  return (
    <div id="file-actions" class="flex shrink-0 items-center gap-1 px-1">
      <Show when={kind() && !document()?.isEditing && !document()?.diffMode}>
        <div id="md-switch" class="button-group" role="group" aria-label="Preview or source">
          <button
            data-md="preview"
            title={withKeys('Rendered view ({Alt+M})')}
            class="btn"
            data-variant={preview() ? 'secondary' : 'outline'}
            data-size="xs"
            aria-pressed={preview()}
            onClick={() => {
              if (!preview()) actions.togglePreview(document(), document().cur);
            }}
          >
            {kind() === 'table' ? 'Table' : 'Preview'}
          </button>
          <button
            data-md="source"
            class="btn"
            data-variant={!preview() ? 'secondary' : 'outline'}
            data-size="xs"
            aria-pressed={!preview()}
            onClick={source}
          >
            Source
          </button>
        </div>
      </Show>
      <Show when={canDiff(document(), editor.store.state.workspace.meta) && !document()?.isEditing}>
        <div id="diff-switch" class="button-group" role="group" aria-label="File or changes">
          <button
            id="diff-source"
            title={withKeys('Show the file ({Mod+D})')}
            class="btn"
            data-size="xs"
            aria-pressed={!document().diffMode}
            onClick={source}
          >
            File
          </button>
          <button
            id="diff-btn"
            title={withKeys('Show what changed ({Mod+D})')}
            class="btn"
            data-size="xs"
            aria-pressed={!!document().diffMode}
            onClick={() =>
              actions.setDiffMode(document(), localStorage.getItem('faah.diffLayout') || 'split')
            }
          >
            Changes
          </button>
        </div>
        <Show when={document().diffMode}>
          <button
            id="diff-layout"
            class="btn"
            data-variant="ghost"
            data-size="icon-xs"
            title={
              document().diffMode === 'split'
                ? 'Show changes in one column'
                : 'Show changes side by side'
            }
            aria-label={
              document().diffMode === 'split'
                ? 'Show changes in one column'
                : 'Show changes side by side'
            }
            onClick={() =>
              actions.setDiffMode(document(), document().diffMode === 'split' ? 'unified' : 'split')
            }
          >
            <span
              class={
                document().diffMode === 'split'
                  ? 'icon-[lucide--rectangle-vertical] size-3.5'
                  : 'icon-[lucide--columns-2] size-3.5'
              }
            />
          </button>
        </Show>
      </Show>
      <EditControls />
    </div>
  );
}
