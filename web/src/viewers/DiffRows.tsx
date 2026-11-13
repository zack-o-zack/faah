import type { DiffRowsProps } from './diff-view.ts';
import type { PaintedRow, PaintedPair } from './diff-rows.ts';
interface DiffSlotProps extends Pick<
  DiffRowsProps,
  'document' | 'diagnostics' | 'reviewable' | 'jump' | 'mode'
> {
  row: PaintedRow | PaintedPair | undefined;
  index: number;
  observer: ResizeObserver;
}
import type { JSX } from 'solid-js';
import { createMemo, createSignal, Index, onCleanup, onMount, Show } from 'solid-js';
import { splitRows, unifiedRows, rowOffsets, measuredWindow } from './diff-rows.ts';
import { DiffSide, UnifiedRow } from './DiffRow.tsx';
import { RowComposers } from '../pr/RowComments.tsx';

function DiffSlot(props: DiffSlotProps): JSX.Element {
  let row: HTMLDivElement | undefined;
  const left = () => (props.row && 'left' in props.row ? props.row.left : undefined);
  const right = () => (props.row && 'right' in props.row ? props.row.right : undefined);
  const unified = () => (props.row && 'type' in props.row ? props.row : undefined);
  onMount(() => {
    const element = row;
    if (!element) return;
    props.observer.observe(element);
    onCleanup(() => props.observer.unobserve(element));
  });
  return (
    <div ref={row} data-slot={props.index}>
      <Show
        when={props.mode === 'unified'}
        fallback={
          <div class="diff-row-pair">
            <DiffSide
              row={left()}
              side="left"
              document={props.document}
              diagnostics={props.diagnostics}
              reviewable={props.reviewable}
              jump={props.jump}
            />
            <DiffSide
              row={right()}
              side="right"
              document={props.document}
              diagnostics={props.diagnostics}
              reviewable={props.reviewable}
              jump={props.jump}
            />
          </div>
        }
      >
        <UnifiedRow
          row={unified()}
          document={props.document}
          diagnostics={props.diagnostics}
          reviewable={props.reviewable}
          jump={props.jump}
        />
      </Show>
      <Show when={props.reviewable}>
        <RowComposers
          path={props.document.path}
          rows={props.mode === 'unified' ? [unified()] : [left(), right()]}
        />
      </Show>
    </div>
  );
}
export function DiffRows(props: DiffRowsProps): JSX.Element {
  let table: HTMLDivElement | undefined;
  const heights = new Map<number, number>();
  const [revision, updateHeights] = createSignal(0);
  const [origin, setOrigin] = createSignal(0);
  const rows = createMemo(() =>
    props.mode === 'unified' ? unifiedRows(props.hunk.rows) : splitRows(props.hunk.rows),
  );
  const offsets = createMemo(() => {
    revision();
    return rowOffsets(rows().length, heights);
  });
  const window = createMemo(() =>
    measuredWindow(offsets(), Math.max(0, props.top - origin()), props.height),
  );
  const slots = () =>
    Array.from({ length: window().end - window().start }, (_, i) => window().start + i);
  const observer = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const index = +(entry.target.getAttribute('data-slot') || 0);
      const height = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
      if (height && heights.get(index) !== height) {
        heights.set(index, height);
        changed = true;
      }
    }
    if (changed) updateHeights((value) => value + 1);
  });
  onCleanup(() => observer.disconnect());
  onMount(() => {
    const element = table;
    if (!element) return;
    const position = new ResizeObserver(() => setOrigin(element.offsetTop));
    if (element.parentElement) position.observe(element.parentElement);
    setOrigin(element.offsetTop);
    const locate = (line: number) => {
      const index = rows().findIndex((row) => {
        const candidates = 'type' in row ? [row] : [row.right, row.left];
        return candidates.some((row) => row && (row.newLine === line || row.at === line));
      });
      return index >= 0 ? element.offsetTop + (offsets()[index] || 0) : null;
    };
    const release = props.registerRows?.(locate);
    onCleanup(() => {
      position.disconnect();
      release?.();
    });
  });
  return (
    <div ref={table} class={`diff-table diff-${props.mode}`}>
      <div style={{ height: `${window().before}px` }} />
      <Index each={slots()}>
        {(index) => (
          <DiffSlot
            index={index()}
            row={rows()[index()]}
            mode={props.mode}
            document={props.document}
            diagnostics={props.diagnostics}
            reviewable={props.reviewable}
            jump={props.jump}
            observer={observer}
          />
        )}
      </Index>
      <div style={{ height: `${window().after}px` }} />
    </div>
  );
}
