import { createMemo, Index } from 'solid-js';
import { useEditor } from './context.tsx';
export function Minimap() {
  const editor = useEditor();
  const positions = createMemo(() => {
    const seen = new Set();
    const total = editor.active()?.total || 1;
    for (const hit of editor.ui.hits) {
      if (hit) seen.add(Math.round(((hit.line - 1) / total) * 400) / 4);
    }
    return [...seen];
  });
  return (
    <div
      id="minimap-hits"
      class="absolute inset-y-0 right-0 z-[6] w-3 empty:pointer-events-none"
      hidden={!editor.settings.preferences().minimap}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        editor.actions.centerLine(
          Math.round(((event.clientY - rect.top) / rect.height) * (editor.active()?.total || 1)),
        );
      }}
    >
      <Index each={positions()}>{(top) => <i style={{ top: `${top()}%` }} />}</Index>
    </div>
  );
}
