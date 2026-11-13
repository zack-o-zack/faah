import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { parseDiff } from './diff-parse.ts';
import { diagnosticMap } from './diff-rows.ts';
import { createDiffActions } from './diff-actions.ts';
import { DiffSection } from './DiffSection.jsx';
import { DiffStrip } from './DiffStrip.jsx';

export function DiffContent(props) {
  const editor = useEditor();
  const [expanded, setExpanded] = createSignal(new Map());
  const hunks = createMemo(() => props.data.hunks || parseDiff(props.data.diff || ''));
  const prHunks = createMemo(() => props.data.prHunks || parseDiff(props.data.prDiff || ''));
  const yourHunks = createMemo(() => props.data.yourHunks || parseDiff(props.data.yourDiff || ''));
  const diagnostics = createMemo(() => diagnosticMap(props.document.diagnostics));
  const actions = createDiffActions(
    editor,
    () => props.document,
    (old, next) => {
      setExpanded((current) => {
        const entries = new Map(current);
        const original = [...entries].find(([, value]) => value === old)?.[0] || old;
        entries.set(original, next);
        return entries;
      });
    },
    () => editor.actions.invalidate(props.document),
  );
  const isPR = () =>
    !props.document.diffRef &&
    (props.data.prHunks !== undefined || props.data.prDiff !== undefined);
  function jump(line) {
    editor.actions.setDiffMode(props.document, 'source');
    editor.actions.setView(props.document, 'source');
    editor.actions.patch({ cur: line });
    editor.actions.centerLine(line);
  }
  onMount(() => {
    const frame = requestAnimationFrame(() => {
      if (props.document.diffScroll) props.scrollTo(props.document.diffScroll);
      else if (props.document.cur) props.scrollLine(props.document.cur);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return (
    <div id="diffcontent">
      <DiffStrip document={props.document} stepHunk={props.stepHunk} />
      <Show
        when={isPR()}
        fallback={
          <DiffSection
            bare={!props.document.diffRef}
            document={props.document}
            kind={props.document.diffRef ? 'commit' : 'you'}
            title={
              props.document.turnLabel ||
              (props.document.diffRef
                ? 'In commit ' + props.document.diffRef.slice(0, 7)
                : 'Changes')
            }
            subtitle={
              props.document.diffRef ? 'this commit only, not the working tree' : 'against HEAD'
            }
            hunks={hunks()}
            expanded={expanded()}
            diagnostics={diagnostics()}
            actions={actions}
            canAct={!props.document.diffRef}
            reviewable={!props.document.diffRef}
            registerRows={props.registerRows}
            top={props.top}
            height={props.height}
            jump={jump}
          />
        }
      >
        <DiffSection
          document={props.document}
          defaultCollapsed={props.document.diffScope === 'yours' && yourHunks().length > 0}
          kind="pr"
          title="PR changes"
          subtitle={'from ' + (editor.store.state.workspace.meta?.pr?.base || 'base')}
          hunks={prHunks()}
          expanded={expanded()}
          diagnostics={diagnostics()}
          actions={actions}
          canAct={false}
          reviewable
          registerRows={props.registerRows}
          top={props.top}
          height={props.height}
          jump={jump}
        />
        <DiffSection
          document={props.document}
          defaultCollapsed={props.document.diffScope === 'pr' && prHunks().length > 0}
          kind="you"
          title="Not pushed"
          subtitle="since checkout"
          hunks={yourHunks()}
          expanded={expanded()}
          diagnostics={diagnostics()}
          actions={actions}
          canAct
          reviewable={false}
          registerRows={props.registerRows}
          top={props.top}
          height={props.height}
          jump={jump}
        />
      </Show>
      <Show when={!hunks().length && !isPR()}>
        <div data-ui="diff-empty" class="p-3 text-muted-foreground">
          No changes.
        </div>
      </Show>
    </div>
  );
}
