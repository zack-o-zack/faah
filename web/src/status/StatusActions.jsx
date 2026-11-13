import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { previewKind } from '../viewers/view.ts';
import { Kbd } from '../lib/shortcuts.jsx';
export function StatusActions() {
  const editor = useEditor();
  return (
    <div
      id="footer-actions"
      class="flex items-center gap-1 [#status:has(#footer-sel:not([hidden]))_&]:hidden"
    >
      <button class="btn" onClick={() => editor.actions.openPalette('file')}>
        Files <Kbd combo="Mod+P" />
      </button>
      <button class="btn" onClick={() => editor.actions.showRightInspector('search')}>
        Search
      </button>
      <button class="btn hidden @3xl:inline-flex" onClick={() => editor.actions.openFind()}>
        Find
      </button>
      <button
        class="btn hidden @3xl:inline-flex"
        onClick={() => editor.actions.openPalette('line')}
      >
        Go to
      </button>
      <Show when={previewKind(editor.active()) && !editor.active()?.isEditing}>
        <button
          class="btn hidden @3xl:inline-flex"
          onClick={() => editor.actions.togglePreview(editor.active(), editor.active().cur)}
        >
          Preview
        </button>
      </Show>
      <button
        class="btn hidden @3xl:inline-flex"
        aria-pressed={editor.settings.preferences().wrap}
        onClick={() => editor.actions.toggleWrap()}
      >
        Wrap
      </button>
      <button class="btn hidden @3xl:inline-flex" onClick={() => editor.actions.showHelp()}>
        Help
      </button>
    </div>
  );
}
