import { createEffect, createMemo, onCleanup } from 'solid-js';
import { useEditor } from './context.jsx';
import { textRanges } from './highlights.ts';

export function EditorRow(props) {
  const editor = useEditor();
  let code;
  let row;
  createEffect(() => {
    props.index;
    if (editor.settings.preferences().wrap) {
      props.observer.unobserve(row);
      props.observer.observe(row);
    } else props.observer.unobserve(row);
  });
  onCleanup(() => props.observer.unobserve(row));
  const line = () => props.index + 1;
  const html = createMemo(() => {
    editor.buffer()?.revision();
    return editor.buffer()?.lines[props.index] || '';
  });
  const current = createMemo(() => editor.active()?.cur === line());
  const agent = createMemo(() =>
    editor.agents
      .targets()
      .some(
        (target) =>
          target.path === editor.active()?.path && line() >= target.l1 && line() <= target.l2,
      ),
  );
  const reference = createMemo(() => {
    const range = editor.store.state.navigation.reference;
    return range?.path === editor.active()?.path && line() >= range.l1 && line() <= range.l2;
  });
  const diagnostic = createMemo(() =>
    editor.active()?.diagnostics?.find((item) => item.line === line()),
  );
  const deleted = createMemo(() => editor.active()?.gutter?.dels?.has(line()));
  const gutter = createMemo(() => editor.active()?.gutter?.marks?.get(line()));
  const selected = createMemo(() => {
    const selection = editor.ui.selection;
    return (
      selection?.path === editor.active()?.path && line() >= selection.l1 && line() <= selection.l2
    );
  });
  createEffect(() => {
    html();
    const navigation = editor.store.state.navigation;
    props.highlights.update(code, [
      ['editor-occ', textRanges(code, navigation.occurrence)],
      [
        'editor-find',
        textRanges(code, editor.ui.findOpen ? editor.ui.query : '', editor.ui.caseSensitive),
      ],
      [
        'editor-link',
        textRanges(code, navigation.link?.line === line() ? navigation.link.word : ''),
      ],
      [
        'editor-active',
        editor.ui.hits[editor.ui.activeHit]?.line === line()
          ? textRanges(code, editor.ui.query, editor.ui.caseSensitive).slice(
              editor.ui.hits[editor.ui.activeHit].n || 0,
              (editor.ui.hits[editor.ui.activeHit].n || 0) + 1,
            )
          : [],
      ],
    ]);
  });
  onCleanup(() => props.highlights.remove(code));
  // Line HTML is syntax-highlighted by the server.
  return (
    <div
      ref={row}
      class={`row group/line flex min-h-[var(--lh)] font-mono text-[length:var(--fs)]
        leading-[var(--lh)]`}
      onClick={(event) => {
        if (!event.target.closest('button'))
          editor.actions.focusAgentAt(editor.active().path, line());
      }}
      data-l={line()}
      classList={{
        cur: current(),
        'agent-sel': agent(),
        'selection-line': selected(),
        'ref-range': reference(),
        'gut-del': deleted(),
        'row-has-err': !!diagnostic() && (diagnostic().severity || 1) === 1,
        'row-has-warn': !!diagnostic() && diagnostic().severity > 1,
      }}
    >
      <div
        class={`g sticky left-0 z-[2] shrink-0 bg-background pl-4 pr-3.5 text-right text-faint
          select-none tabular-nums`}
        classList={{ 'gut-add': gutter() === 'add', 'gut-mod': gutter() === 'mod' }}
        style={{ width: `calc(${String(editor.active()?.total || 1).length}ch + 30px)` }}
      >
        <button
          class="btn absolute left-0 opacity-0 group-hover/line:opacity-100"
          data-control="line-btn"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) =>
            editor.actions.openLineActions(
              {
                path: editor.active().path,
                l1: line(),
                l2: line(),
                text: editor.buffer().text(props.index),
              },
              event.clientX,
              event.clientY,
            )
          }
        >
          Edit
        </button>
        {line()}
      </div>
      <div
        ref={code}
        class={`c min-w-0 flex-1 whitespace-pre pr-10 [body.word-wrap_&]:whitespace-pre-wrap
          [body.word-wrap_&]:break-words [body.word-wrap_&]:[overflow-wrap:anywhere]`}
        data-diag={diagnostic()?.message?.split('\n')[0]}
        // eslint-disable-next-line solid/no-innerhtml, no-restricted-syntax -- Server-highlighted source.
        innerHTML={html()}
      />
    </div>
  );
}
