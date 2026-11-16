import { TabRail } from '../lib/TabRail.tsx';
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
  const explainable = () => {
    const file = document();
    return (
      file &&
      file.total > 0 &&
      viewMode(file) === 'source' &&
      !file.isEditing &&
      !file.deleted &&
      !file.diffRef
    );
  };
  const explaining = () =>
    editor.threads.state.pending === 'explain' ||
    editor.threads.state.list.some(
      (thread) => thread.kind === 'explain' && thread.path === document()?.path && thread.running,
    );
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
        <TabRail id="md-switch" label="Preview or source">
          <button
            id="md-preview"
            data-md="preview"
            title={withKeys('Rendered view ({Alt+M})')}
            role="tab"
            aria-controls="editor"
            tabindex={preview() ? 0 : -1}
            aria-selected={preview()}
            onClick={() => {
              if (!preview()) actions.togglePreview(document(), document()?.cur);
            }}
          >
            {kind() === 'table' ? 'Table' : 'Preview'}
          </button>
          <button
            id="md-source"
            data-md="source"
            role="tab"
            aria-controls="editor"
            tabindex={!preview() ? 0 : -1}
            aria-selected={!preview()}
            onClick={source}
          >
            Source
          </button>
        </TabRail>
      </Show>
      <Show when={canDiff(document(), editor.store.state.workspace.meta) && !document()?.isEditing}>
        <TabRail id="diff-switch" label="File or changes">
          <button
            id="diff-source"
            title={withKeys('Show the file ({Mod+D})')}
            role="tab"
            aria-controls="editor"
            tabindex={!document()?.diffMode ? 0 : -1}
            aria-selected={!document()?.diffMode}
            onClick={source}
          >
            File
          </button>
          <button
            id="diff-btn"
            title={withKeys('Show what changed ({Mod+D})')}
            role="tab"
            aria-controls="editor"
            tabindex={document()?.diffMode ? 0 : -1}
            aria-selected={!!document()?.diffMode}
            onClick={() => actions.setDiffMode(document(), true)}
          >
            Changes
          </button>
        </TabRail>
        <Show when={document()?.diffMode}>
          <DiffOptions id="diff-options" />
        </Show>
      </Show>
      <EditControls />
      <Show when={explainable()}>
        <button
          id="btn-explain-file"
          class="btn"
          data-variant="ghost"
          data-size="icon-xs"
          disabled={explaining()}
          title={explaining() ? 'An explanation for this file is in progress' : 'Explain this file'}
          aria-label="Explain this file"
          onClick={() => {
            const file = document();
            if (file)
              void actions.explainSelection({
                path: file.path,
                file: true,
              });
          }}
        >
          <span class="icon-[ph--sparkle] text-special" aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}
