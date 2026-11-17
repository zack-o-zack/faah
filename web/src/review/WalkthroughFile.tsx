import type { WalkthroughFile as File } from './types.ts';

interface WalkthroughFileProps {
  file: File;
}
import type { JSX } from 'solid-js';
import { createEffect, For, on, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { movedOnly, rowLine } from './logic.ts';
import { splitRows, unifiedRows, type PaintedRow } from '../viewers/diff-rows.ts';
import { NoteGhost } from '../notes/GhostNotes.tsx';
import { WalkTitleLine } from '../notes/WalkthroughTitle.tsx';
import { pluralize } from '../pr/logic.ts';
import { LineStats } from './LineStats.tsx';
import { mergeRanges, missingLines } from './context.ts';
import { reviewContainsRange } from '../viewers/walkthrough-review.ts';
const ROW_TYPE: Record<string, string> = { add: 'diff-type-add', del: 'diff-type-del' };
const SIGN: Record<string, string> = { add: '+', del: '-' };
export function WalkthroughFile(props: WalkthroughFileProps): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  const rows = new Map<number, HTMLDivElement>();
  let header: HTMLDivElement | undefined;
  const target = () => review.state.target;
  const targetLine = () => (target().path === props.file.path ? target().line : -1);
  const split = () => editor.store.settings.preferences().splitDiff;
  const highlightChangedWords = () => editor.settings.preferences().highlightChangedWords;
  const focus = () =>
    editor.walkthrough.surface() === 'review' ? editor.walkthrough.focus() : null;
  const focused = () => focus()?.path === props.file.path;
  const notes = () => editor.turnNotes.byPath().get(props.file.path);
  const outside = () =>
    editor.turnNotes
      .notes()
      .filter(
        (note) =>
          note.path === props.file.path && !reviewContainsRange(props.file, note.l1, note.l2),
      );
  const inStep = (row: PaintedRow | null) =>
    !!row?.newLine &&
    row.type !== 'del' &&
    row.newLine >= (focus()?.l1 || 0) &&
    row.newLine <= (focus()?.l2 || 0);
  // Match the diff's existing number/sign columns for annotations, including split rows.
  const annotation = (content: JSX.Element) => (
    <div class="review-diff-row" data-review-annotation>
      <span class="diff-col-num shrink-0" />
      <Show when={!split()}>
        <span class="diff-col-num shrink-0" />
      </Show>
      <span class="diff-col-sign shrink-0" />
      <div class="diff-code min-w-0 flex-1">{content}</div>
    </div>
  );
  const title = (row: PaintedRow | null) => (
    <Show when={focused() && row?.type !== 'del' && row?.newLine === focus()?.l1}>
      <div data-walk-title role="note" class="py-1 select-none">
        {annotation(
          <WalkTitleLine
            n={focus()?.n || 0}
            of={focus()?.of || 0}
            title={focus()?.title || ''}
            indent={0}
          />,
        )}
      </div>
    </Show>
  );
  const rowNotes = (row: PaintedRow | null) => (
    <Show when={row?.newLine && row.type !== 'del'}>
      <For each={notes()?.get(row?.newLine || 0)}>
        {(note) => annotation(<NoteGhost note={note} notes={editor.turnNotes} review />)}
      </For>
    </Show>
  );
  const renderRow = (row: PaintedRow | null, side?: 'left' | 'right') => (
    <div
      ref={(element) => {
        if (row && (side !== 'left' || row.type === 'del')) rows.set(rowLine(row), element);
      }}
      class={`review-diff-row ${row ? ROW_TYPE[row.type] || 'diff-type-ctx' : ''}`}
      data-new-line={row?.newLine}
      classList={{
        'bg-cur': focused() && inStep(row),
        'diff-row-flash': !!row && targetLine() === rowLine(row),
        'bg-special/5!':
          !!row?.newLine && editor.turnNotes.highlighted(props.file.path, row.newLine),
      }}
    >
      <Show when={side !== 'right'}>
        <span class="diff-col-num">{row?.oldLine || ''}</span>
      </Show>
      <Show when={side !== 'left'}>
        <span class="diff-col-num">{row?.newLine || ''}</span>
      </Show>
      <span class="diff-col-sign">{SIGN[row?.type || ''] || ' '}</span>
      <span class="diff-code c">
        <For each={row?.parts}>{(part) => <span class={part.className}>{part.text}</span>}</For>
      </span>
    </div>
  );
  // Native scroll for a requested reveal of this file or one of its lines.
  createEffect(
    on(
      () => target().sequence,
      () => {
        if (target().path !== props.file.path) return;
        const row = rows.get(target().line);
        if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        else header?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
    ),
  );
  return (
    <div class="relative mb-3 overflow-clip rounded-md border">
      <div
        ref={header}
        class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b bg-sidebar px-3 py-2 text-xs"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="icon-[ph--file] shrink-0 text-muted-foreground" />
          <span class="min-w-0 truncate font-mono font-semibold">
            {props.file.path}
            <span class="block truncate text-muted-foreground" title={props.file.oldPath}>
              {props.file.oldPath}
            </span>
          </span>
          <span class="shrink-0 font-mono">
            <LineStats additions={props.file.additions} deletions={props.file.deletions} />
          </span>
        </div>
        <Show when={outside().length}>
          <button
            class="btn text-muted-foreground"
            data-variant="ghost"
            data-size="xs"
            onClick={async () => {
              const note = outside()[0];
              if (!note) return;
              const ranges = mergeRanges(
                outside().flatMap((note) => missingLines(props.file, note.l1, note.l2)),
              );
              if (!(await review.actions.expandReviewContext(props.file.path, ranges)))
                await editor.actions.openReviewReference({
                  path: note.path,
                  line: note.l1,
                  end: note.l2,
                });
            }}
          >
            Show {pluralize(outside().length, 'note')}
          </button>
        </Show>
        <label class="inline-flex cursor-pointer items-center gap-2 text-muted-foreground select-none">
          <input
            type="checkbox"
            class="input"
            checked={!!review.state.viewed[props.file.path]}
            onChange={(event) =>
              editor.actions.setWalkthroughViewed(props.file.path, event.currentTarget.checked)
            }
          />
          <span>Viewed</span>
        </label>
      </div>
      <div class="review-diff-table">
        <For
          each={props.file.hunks}
          fallback={
            <div class="empty p-3 text-center text-muted-foreground">
              {movedOnly(props.file)
                ? `Moved from ${props.file.oldPath}, no content changes`
                : 'No diff hunks to display.'}
            </div>
          }
        >
          {(hunk) => (
            <>
              <div class="bg-muted/40 px-3 py-1 font-mono text-xs text-muted-foreground select-none">
                @@ -{hunk.oldStart || 0} +{hunk.newStart || 0} @@ {hunk.section || ''}
              </div>
              <Show
                when={split()}
                fallback={
                  <For each={unifiedRows(hunk.rows, highlightChangedWords())}>
                    {(row) => (
                      <>
                        {title(row)}
                        {renderRow(row)}
                        {rowNotes(row)}
                      </>
                    )}
                  </For>
                }
              >
                <For each={splitRows(hunk.rows, highlightChangedWords())}>
                  {(pair) => (
                    <>
                      <Show when={focused() && pair.right?.newLine === focus()?.l1}>
                        <div class="diff-row-pair">
                          <div class="diff-side diff-side-left" />
                          <div class="diff-side">{title(pair.right)}</div>
                        </div>
                      </Show>
                      <div class="diff-row-pair">
                        <div class="diff-side diff-side-left">{renderRow(pair.left, 'left')}</div>
                        <div class="diff-side">{renderRow(pair.right, 'right')}</div>
                      </div>
                      <Show when={!!pair.right?.newLine && notes()?.has(pair.right.newLine)}>
                        <div class="diff-row-pair">
                          <div class="diff-side diff-side-left" />
                          <div class="diff-side">{rowNotes(pair.right)}</div>
                        </div>
                      </Show>
                    </>
                  )}
                </For>
              </Show>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
