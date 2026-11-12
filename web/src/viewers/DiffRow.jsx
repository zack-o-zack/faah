import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { gutterAnchor, gutterSelection } from './diff-rows.js';

function Gutter(props) {
  const editor = useEditor();
  return (
    <div
      class="diff-ln"
      classList={{ 'diff-ln-nav': props.number !== undefined }}
      title={`Open in file view at line ${props.number}`}
      onClick={() => props.jump(props.line)}
    >
      <Show when={props.number !== undefined}>
        <button
          type="button"
          class="btn absolute left-0 top-1/2 -translate-y-1/2 h-4! px-1! text-9! opacity-0 pointer-events-none group-hover/line:opacity-100 group-hover/line:pointer-events-auto group-[.agent-anchor]/line:opacity-100 group-[.agent-anchor]/line:pointer-events-auto"
          data-control="line-btn"
          data-variant="ghost"
          data-size="xs"
          onClick={(event) => {
            event.stopPropagation();
            editor.actions.openSelectionMenu(
              gutterSelection(props.row, props.document.path, props.reviewable),
              event.clientX,
              event.clientY,
            );
          }}
        >
          •••
        </button>
        {props.number}
      </Show>
    </div>
  );
}
function Code(props) {
  return (
    <div
      class="diff-code"
      data-diag={props.diagnostic?.message?.split('\n')[0]}
      data-diag-warn={props.diagnostic && props.diagnostic.severity !== 1 ? '' : undefined}
    >
      <For each={props.row?.parts || []}>
        {(part) => <span class={part.className}>{part.text}</span>}
      </For>
    </div>
  );
}
export function DiffSide(props) {
  const editor = useEditor();
  const anchor = () => gutterAnchor(props.row);
  const ranges = () =>
    editor.store.state.agents.targets.filter((range) => range.path === props.document.path);
  const number = () => (props.side === 'left' ? props.row?.oldLine : props.row?.newLine);
  return (
    <div
      class={`group/line diff-side diff-side-${props.side} ${props.row ? 'diff-' + props.row.type : 'diff-blank'}`}
      data-l={anchor().line}
      data-at={anchor().at}
      data-old-l={anchor().oldLine}
      data-reviewable={props.reviewable ? undefined : '0'}
      classList={{
        'agent-sel': ranges().some(
          (range) => anchor().line >= range.l1 && anchor().line <= range.l2,
        ),
        'agent-anchor': ranges().some((range) => anchor().line === range.l1),
      }}
    >
      <Gutter
        number={number()}
        line={anchor().line ?? anchor().at}
        row={props.row}
        side={props.side === 'left' ? 'LEFT' : 'RIGHT'}
        document={props.document}
        reviewable={props.reviewable}
        jump={props.jump}
      />
      <div class="diff-mk">{{ add: '+', del: '−' }[props.row?.type] || ' '}</div>
      <Code
        row={props.row}
        diagnostic={props.side === 'right' ? props.diagnostics.get(anchor().line) : undefined}
      />
    </div>
  );
}
export function UnifiedRow(props) {
  const editor = useEditor();
  const ranges = () =>
    editor.store.state.agents.targets.filter((range) => range.path === props.document.path);
  const anchor = () => gutterAnchor(props.row);
  return (
    <div
      class={`group/line diff-row diff-${props.row.type}`}
      classList={{
        'agent-sel': ranges().some(
          (range) => anchor().line >= range.l1 && anchor().line <= range.l2,
        ),
        'agent-anchor': ranges().some((range) => anchor().line === range.l1),
      }}
      data-l={anchor().line}
      data-at={anchor().at}
      data-old-l={anchor().oldLine}
      data-reviewable={props.reviewable ? undefined : '0'}
    >
      <Gutter
        number={props.row.oldLine}
        line={anchor().line ?? anchor().at}
        row={props.row}
        side="LEFT"
        document={props.document}
        reviewable={props.reviewable}
        jump={props.jump}
      />
      <Gutter
        number={props.row.newLine}
        line={anchor().line ?? anchor().at}
        row={props.row}
        side="RIGHT"
        document={props.document}
        reviewable={props.reviewable}
        jump={props.jump}
      />
      <div class="diff-mk">{{ add: '+', del: '−' }[props.row.type] || ' '}</div>
      <Code row={props.row} diagnostic={props.diagnostics.get(anchor().line)} />
    </div>
  );
}
