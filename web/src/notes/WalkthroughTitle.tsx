import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ghostIndent, GHOST_PADDING_TOP, GHOST_PADDING_BOTTOM } from './layout.ts';

/** Source annotations need a virtualized slot outside the file's selectable text. */
export function WalkthroughTitle(props: { line: number }): JSX.Element {
  const editor = useEditor();
  const step = () => editor.walkthrough.focus();
  return (
    <Show when={step()?.l1 === props.line}>
      <div
        data-note
        data-walk-title
        role="note"
        class="select-none pr-4 font-mono text-xs text-special"
        style={{
          height: `${editor.notes.rowHeight()}px`,
          'max-width': `${editor.geometry.width}px`,
          'padding-left': `${ghostIndent(editor.active()?.total || 1, editor.settings.preferences().lineNumbers, editor.geometry.charWidth, editor.buffer()?.lines[props.line - 1] || '')}px`,
          'padding-top': `${GHOST_PADDING_TOP}px`,
          'padding-bottom': `${GHOST_PADDING_BOTTOM}px`,
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <WalkTitleLine
          n={step()?.n || 0}
          of={step()?.of || 0}
          title={step()?.title || ''}
          indent={0}
        />
      </div>
    </Show>
  );
}

export function WalkTitleLine(props: {
  n: number;
  of: number;
  title: string;
  indent: number;
}): JSX.Element {
  return (
    <span
      class="flex min-w-0 items-center gap-1.5 font-mono text-xs text-special"
      style={{ 'padding-left': `${props.indent}px` }}
    >
      <span class="icon-[ph--sparkle] size-3 shrink-0" aria-hidden="true" />
      <span class="shrink-0">
        {props.n}/{props.of}
      </span>
      <span class="truncate">{props.title}</span>
    </span>
  );
}
