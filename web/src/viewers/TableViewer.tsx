import type { DocTab } from '../editor/types.ts';
import type { TableReply } from './decode.ts';

interface TableViewerProps {
  data: TableReply;
  document: DocTab;
  jump: (line: number) => void;
}
import type { JSX } from 'solid-js';
import { createMemo, For, Index, Show } from 'solid-js';
export function TableViewer(props: TableViewerProps): JSX.Element {
  const columns = createMemo(() => Array.from({ length: props.data.cols }, (_, i) => i));
  const rows = () => props.data.rows.slice(0, 1000);
  function jumpKey(event: KeyboardEvent, line: number) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.jump(line);
  }
  return (
    <>
      <Show when={props.data.cols} fallback={<p class="csv-empty">This file is empty.</p>}>
        <table class="csv-t">
          <thead>
            <tr data-line={props.data.headerLine || 1}>
              <th
                class="ln"
                role="button"
                tabIndex={0}
                aria-label={`Open source line ${props.data.headerLine || 1}`}
                onClick={() => props.jump(props.data.headerLine || 1)}
                onKeyDown={(event) => jumpKey(event, props.data.headerLine || 1)}
              >
                {props.data.headerLine || 1}
              </th>
              <Index each={columns()}>
                {(_column, i) => <th>{props.data.header[i] || ''}</th>}
              </Index>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row) => (
                <tr data-line={row.line}>
                  <td
                    class="ln"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open source line ${row.line}`}
                    onClick={() => props.jump(row.line)}
                    onKeyDown={(event) => jumpKey(event, row.line)}
                  >
                    {row.line}
                  </td>
                  <Index each={columns()}>
                    {(_column, i) => (
                      <td
                        classList={{
                          miss: i >= row.cells.length && i < props.data.header.length,
                        }}
                      >
                        {row.cells[i] || ''}
                      </td>
                    )}
                  </Index>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={props.data.truncated || props.data.rows.length > 1000}>
          <div class="csv-cap">
            Showing the first {rows().length.toLocaleString()} rows of a{' '}
            {props.document.total.toLocaleString()}-line file.{' '}
            <button class="csv-open-source" onClick={() => props.jump(1)}>
              Open Source
            </button>{' '}
            to see the rest.
          </div>
        </Show>
      </Show>
    </>
  );
}
