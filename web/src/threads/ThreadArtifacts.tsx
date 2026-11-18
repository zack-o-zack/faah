import { For, Show, createMemo, type JSX } from 'solid-js';
import { Spiral } from '../brand/Spiral.tsx';
import { useEditor } from '../editor/context.tsx';
import type { Thread, ThreadTurn, Walkthrough } from './decode.ts';

interface NoteFile {
  path: string;
  l1: number;
  count: number;
}
interface ThreadArtifactsProps {
  turn: ThreadTurn;
  thread: Thread;
}
export function ThreadArtifacts(props: ThreadArtifactsProps): JSX.Element {
  const editor = useEditor();
  const shown = () => {
    const model = editor.store.state.explanation.model;
    return model?.id === props.thread.id && model.turn === props.turn.id;
  };
  const files = createMemo(() => {
    const groups = new Map<string, NoteFile>();
    for (const note of props.turn.notes || []) {
      const group = groups.get(note.path);
      if (group) {
        group.l1 = Math.min(group.l1, note.l1);
        group.count++;
      } else groups.set(note.path, { path: note.path, l1: note.l1, count: 1 });
    }
    return [...groups.values()];
  });
  // Any thread can save notes and walkthroughs; only an explanation shows its card while it runs.
  const visible = () =>
    (props.thread.kind === 'explain' && props.turn.running) ||
    !!props.turn.notes?.length ||
    !!props.turn.walkthroughs?.length;
  return (
    <Show when={visible()}>
      <section
        data-ui="thr-artifacts"
        aria-label="Explanation on the code"
        class="card gap-0! overflow-hidden rounded-lg p-0! text-xs"
      >
        <ArtifactHeader {...props} shown={shown()} />
        <For each={props.turn.walkthroughs}>
          {(walk, index) => (
            <ArtifactSteps {...props} walk={walk} index={index()} shown={shown()} />
          )}
        </For>
        <ArtifactNotes {...props} files={files()} />
      </section>
    </Show>
  );
}

function ArtifactHeader(props: ThreadArtifactsProps & { shown: boolean }): JSX.Element {
  const editor = useEditor();
  return (
    <div class="flex flex-wrap items-center gap-2 border-b px-2.5 py-2">
      <span class="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Show
          when={props.turn.running}
          fallback={
            <>
              <span class="icon-[ph--spinner] shrink-0 text-special" aria-hidden="true" />
              <span class="min-w-0 wrap-anywhere">
                {props.turn.walkthroughs?.length
                  ? `Walkthrough · ${props.turn.walkthroughs[0]?.title}`
                  : 'Notes on the code'}
              </span>
            </>
          }
        >
          <Spiral state="thinking" size={18} />
          <output>{props.turn.notes?.length || 0} notes so far</output>
        </Show>
      </span>
      <Show when={!props.turn.running}>
        <label class="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-muted-foreground">
          <span>Show in editor</span>
          <input
            type="checkbox"
            role="switch"
            class="input"
            checked={props.shown}
            aria-checked={props.shown}
            onChange={(event) => {
              if (event.currentTarget.checked)
                void editor.actions.showExplanation(props.thread, props.turn.id);
              else editor.actions.dismissOrb();
            }}
          />
        </label>
      </Show>
    </div>
  );
}

function ArtifactSteps(
  props: ThreadArtifactsProps & { walk: Walkthrough; index: number; shown: boolean },
): JSX.Element {
  const editor = useEditor();
  return (
    <div>
      <Show when={props.index > 0}>
        <h3 class="px-2.5 pt-1.5 text-xs font-normal text-muted-foreground">{props.walk.title}</h3>
      </Show>
      <ol aria-label={props.walk.title} class="flex flex-col gap-0.5 px-2.5 py-1.5">
        <For each={props.walk.steps}>
          {(step, position) => {
            const current = () => {
              const walk = editor.store.state.explanation.walk;
              return props.shown && walk?.index === props.index && walk.step === position();
            };
            return (
              <li>
                <button
                  type="button"
                  class="btn h-auto! w-full justify-start! gap-2 rounded-sm! border-0 px-1.5! py-1! text-left text-xs font-normal whitespace-normal"
                  classList={{ 'bg-[var(--hover,var(--accent))]!': current() }}
                  data-variant="ghost"
                  aria-current={current() ? 'step' : undefined}
                  title={step.body}
                  onClick={() =>
                    void editor.actions.showExplanation(props.thread, props.turn.id, {
                      walkthrough: true,
                      index: props.index,
                      step: position(),
                    })
                  }
                >
                  <span
                    class="grid h-5 w-5 shrink-0 place-items-center rounded-pill text-11 font-semibold"
                    classList={{
                      'bg-muted text-muted-foreground': !current(),
                      'bg-foreground text-background': current(),
                    }}
                    aria-hidden="true"
                  >
                    {position() + 1}
                  </span>
                  <span class="min-w-0 wrap-anywhere">{step.title}</span>{' '}
                  <span class="ml-auto shrink-0 font-mono text-muted-foreground">:{step.l1}</span>
                </button>
              </li>
            );
          }}
        </For>
      </ol>
    </div>
  );
}

function ArtifactNotes(props: ThreadArtifactsProps & { files: NoteFile[] }): JSX.Element {
  const editor = useEditor();
  return (
    <Show when={props.files.length}>
      <div class="flex flex-wrap gap-1.5 px-2.5 pt-1.5 pb-2.5">
        <For each={props.files}>
          {(file) => (
            <button
              type="button"
              class="badge max-w-full cursor-pointer gap-1 rounded-pill px-2 py-0.5 text-xs font-normal hover:bg-accent"
              data-variant="outline"
              title={file.path}
              onClick={() =>
                void editor.actions.showExplanation(props.thread, props.turn.id, { note: file })
              }
            >
              <span class="icon-[ph--note] shrink-0" aria-hidden="true" />
              <span class="truncate font-mono">{file.path.split('/').at(-1)}</span>{' '}
              <span class="shrink-0 font-normal text-muted-foreground">
                {file.count} {file.count === 1 ? 'note' : 'notes'}
              </span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
