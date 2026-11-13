import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { PILL_ICONS } from './logic.ts';
const TONES: Record<string, string> = { err: 'text-destructive', warn: 'text-warn', ok: 'text-gi' };
export function MergePill(): JSX.Element {
  const editor = useEditor();
  const pill = () => editor.merge.pill();
  return (
    <Show when={pill()}>
      <span
        id="pr-merge-state"
        role="status"
        class={`inline-flex shrink-0 items-center gap-1 ${TONES[pill()?.tone || ''] || ''}`}
        title={pill()?.title}
      >
        <span class={`${PILL_ICONS[pill()?.tone || ''] || PILL_ICONS.muted} size-3.5 shrink-0`} />
        <span>{pill()?.text}</span>
      </span>
    </Show>
  );
}
