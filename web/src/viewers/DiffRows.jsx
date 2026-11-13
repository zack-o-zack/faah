import { createMemo, createSignal, Index, onCleanup, onMount, Show } from 'solid-js';
import { splitRows, unifiedRows, rowOffsets, measuredWindow } from './diff-rows.ts';
import { DiffSide, UnifiedRow } from './DiffRow.jsx';
import { RowComposers } from '../pr/RowComments.jsx';

function DiffSlot(props) {
  let row;
  onMount(() => {
    props.observer.observe(row);
    onCleanup(() => props.observer.unobserve(row));
  });
  return (
    <div ref={row} data-slot={props.index}>
      <Show
        when={props.mode === 'unified'}
        fallback={
          <div class="diff-row-pair">
            <DiffSide
              row={props.row.left}
              side="left"
              document={props.document}
              diagnostics={props.diagnostics}
              reviewable={props.reviewable}
              jump={props.jump}
            />
            <DiffSide
              row={props.row.right}
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
          row={props.row}
          document={props.document}
          diagnostics={props.diagnostics}
          reviewable={props.reviewable}
          jump={props.jump}
        />
      </Show>
      <Show when={props.reviewable}>
        <RowComposers
          path={props.document.path}
          rows={props.mode === 'unified' ? [props.row] : [props.row.left, props.row.right]}
        />
      </Show>
    </div>
  );
}
export function DiffRows(props) {
  let table;
  const heights = new Map();
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
      const index = +entry.target.dataset.slot;
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
    const position = new ResizeObserver(() => setOrigin(table.offsetTop));
    position.observe(table.parentElement);
    setOrigin(table.offsetTop);
    const locate = (line) => {
      const index = rows().findIndex((row) => {
        const candidates = props.mode === 'unified' ? [row] : [row.right, row.left];
        return candidates.some((row) => row && (row.newLine === line || row.at === line));
      });
      return index >= 0 ? table.offsetTop + offsets()[index] : null;
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
