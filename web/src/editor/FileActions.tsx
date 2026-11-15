import type { JSX } from 'solid-js';
import { DiffOptions } from '../viewers/DiffOptions.tsx';
import { Show } from 'solid-js';
import { useEditor } from './context.tsx';
import { EditControls } from './EditControls.tsx';
import { canDiff, previewKind, viewMode } from '../viewers/view.ts';
import { withKeys } from '../lib/keyboard.ts';

export function FileActions(): JSX.Element {
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
              if (!preview()) actions.togglePreview(document(), document()?.cur);
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
            aria-pressed={!document()?.diffMode}
            onClick={source}
            data-variant={!document()?.diffMode ? 'secondary' : 'outline'}
          >
            File
          </button>
          <button
            id="diff-btn"
            title={withKeys('Show what changed ({Mod+D})')}
            class="btn"
            data-size="xs"
            aria-pressed={!!document()?.diffMode}
            onClick={() => actions.setDiffMode(document(), true)}
            data-variant={document()?.diffMode ? 'secondary' : 'outline'}
          >
            Changes
          </button>
        </div>
        <Show when={document()?.diffMode}>
          <DiffOptions id="diff-options" />
        </Show>
      </Show>
      <EditControls />
    </div>
  );
}
