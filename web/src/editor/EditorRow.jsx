import { createEffect, createMemo, onCleanup } from 'solid-js';
import { useEditor } from './context.jsx';
import { markFind, markOccurrences, textRanges } from './highlights.ts';

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
  createEffect(() => {
    html();
    const navigation = editor.store.state.navigation;
    markOccurrences(code, navigation.occurrence);
    const hit = editor.ui.hits[editor.ui.activeHit];
    markFind(
      code,
      editor.ui.findOpen ? editor.ui.query : '',
      editor.ui.caseSensitive,
      hit?.line === line() ? hit.n || 0 : -1,
    );
    props.highlights.update(code, [
      [
        'editor-link',
        textRanges(code, navigation.link?.line === line() ? navigation.link.word : ''),
      ],
    ]);
  });
  onCleanup(() => props.highlights.remove(code));
  // Line HTML is syntax-highlighted by the server.
  return (
    <div
      ref={row}
      class="row group/line flex h-[var(--lh)] [body.word-wrap_&]:h-auto [body.word-wrap_&]:min-h-[var(--lh)] font-mono text-[length:var(--fs)] leading-[var(--lh)] [font-feature-settings:normal]"
      onClick={(event) => {
        if (!event.target.closest('button'))
          editor.actions.focusAgentAt(editor.active().path, line());
      }}
      data-l={line()}
      classList={{
        cur: current(),
        'agent-sel': agent(),
        'ref-range': reference(),
        'gut-del': deleted(),
        'row-has-err': !!diagnostic() && (diagnostic().severity || 1) === 1,
        'row-has-warn': !!diagnostic() && diagnostic().severity > 1,
      }}
    >
      <div
        class="g sticky left-0 z-[2] shrink-0 pl-4 pr-3.5 text-right text-faint bg-background group-[.cur]/line:bg-cur group-[.cur]/line:text-foreground group-[.ref-range]/line:bg-sel group-[.agent-sel]/line:text-primary group-[.agent-sel]/line:font-semibold group-[.agent-anchor]/line:relative select-none cursor-pointer tabular-nums"
        classList={{ 'gut-add': gutter() === 'add', 'gut-mod': gutter() === 'mod' }}
        style={{ width: `calc(${String(editor.active()?.total || 1).length}ch + 30px)` }}
      >
        <button
          class="btn absolute left-0 top-1/2 -translate-y-1/2 max-w-full truncate h-4! px-1! text-9! opacity-0 pointer-events-none group-hover/line:opacity-100 group-hover/line:pointer-events-auto group-[.agent-anchor]/line:opacity-100 group-[.agent-anchor]/line:pointer-events-auto"
          data-variant="ghost"
          data-size="xs"
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
