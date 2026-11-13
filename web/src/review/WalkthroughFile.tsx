import type { WalkthroughFile as File } from './types.ts';

interface WalkthroughFileProps {
  file: File;
}
import type { JSX } from 'solid-js';
import { createEffect, For, on } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { rowLine } from './logic.ts';
import { syntaxParts } from '../viewers/diff-intraline.ts';
import { LineStats } from './LineStats.tsx';
const ROW_TYPE: Record<string, string> = { add: 'diff-type-add', del: 'diff-type-del' };
const SIGN: Record<string, string> = { add: '+', del: '-' };
export function WalkthroughFile(props: WalkthroughFileProps): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  const rows = new Map<number, HTMLDivElement>();
  let header: HTMLDivElement | undefined;
  const target = () => review.state.target;
  const targetLine = () => (target().path === props.file.path ? target().line : -1);
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
      { defer: true },
    ),
  );
  return (
    <div
      class="relative mb-3 overflow-clip rounded-md border"
      classList={{ 'opacity-60': !!review.state.viewed[props.file.path] }}
    >
      <div
        ref={header}
        class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b bg-sidebar px-3 py-2 text-xs"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="icon-[lucide--file] size-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 truncate font-mono font-semibold">{props.file.path}</span>
          <span class="shrink-0 font-mono">
            <LineStats additions={props.file.additions} deletions={props.file.deletions} />
          </span>
        </div>
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
            <div class="empty p-3 text-center text-muted-foreground">No diff hunks to display.</div>
          }
        >
          {(hunk) => (
            <>
              <div class="bg-muted/40 px-3 py-1 font-mono text-xs text-muted-foreground select-none">
                @@ -{hunk.oldStart || 0} +{hunk.newStart || 0} @@ {hunk.section || ''}
              </div>
              <For each={hunk.rows}>
                {(row) => (
                  <div
                    ref={(element) => rows.set(rowLine(row), element)}
                    class={`review-diff-row ${ROW_TYPE[row.type] || 'diff-type-ctx'}`}
                    classList={{ 'diff-row-flash': targetLine() === rowLine(row) }}
                  >
                    <span class="diff-col-num">{row.oldLine || ''}</span>
                    <span class="diff-col-num">{row.newLine || ''}</span>
                    <span class="diff-col-sign">{SIGN[row.type] || ' '}</span>
                    <span class="diff-col-code c">
                      <For each={syntaxParts(row.text || '', row.html)}>
                        {(part) => <span class={part.className}>{part.text}</span>}
                      </For>
                    </span>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
