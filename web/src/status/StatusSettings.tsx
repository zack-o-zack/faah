import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
export function StatusSettings(): JSX.Element {
  const editor = useEditor();
  return (
    <button
      id="btn-settings"
      class="btn"
      aria-label="Settings"
      title="Settings"
      data-control="icon-action"
      data-variant="ghost"
      data-size="icon-xs"
      onClick={() => editor.actions.openSettings('ui')}
    >
      <span class="icon-[lucide--settings] size-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
}
