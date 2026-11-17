import { Spiral } from '../brand/Spiral.tsx';
import type { JSX } from 'solid-js';
import type { ThreadTurn } from './decode.ts';
import { For, Index, Show, createMemo, createSignal } from 'solid-js';
import {
  foldToolSteps,
  parseToolStep,
  type StepPaths,
  type ToolRun,
  type ToolStep,
} from './steps.ts';

const rowClass =
  'flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-[3px] whitespace-nowrap hover:bg-[var(--hover,var(--accent))]';

export function ThreadSteps(props: {
  turn: ThreadTurn;
  workspace?: StepPaths | null;
}): JSX.Element {
  const runs = createMemo(() =>
    foldToolSteps(
      (props.turn.tools || []).map((label) => parseToolStep(label, props.workspace || {})),
    ),
  );
  return (
    <Show when={props.turn.running || props.turn.tools?.length}>
      <Show
        when={props.turn.tools?.length}
        fallback={
          <div data-ui="thr-steps" class="flex items-start gap-1.5 text-xs text-muted-foreground">
            <StepHead turn={props.turn} />
          </div>
        }
      >
        <details
          data-ui="thr-steps"
          class="group text-xs text-muted-foreground [&::details-content]:overflow-hidden"
        >
          <summary class="flex cursor-pointer list-none items-start gap-1.5 hover:text-foreground [&::-webkit-details-marker]:hidden">
            <StepHead turn={props.turn} />
          </summary>
          <ol data-ui="thr-step-list" class="mt-1.5 min-w-0">
            <Index each={runs()}>{(run) => <StepRun run={run()} />}</Index>
          </ol>
        </details>
      </Show>
    </Show>
  );
}

function StepRun(props: { run: ToolRun }): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Show
      when={props.run.kind === 'group'}
      fallback={
        <li class={rowClass} title={props.run.step.label}>
          <StepContents step={props.run.step} />
          <Show when={props.run.kind === 'repeat'}>
            <span class="ml-auto shrink-0 rounded-pill bg-muted px-1.5 text-11 text-muted-foreground">
              ×{props.run.steps.length}
            </span>
          </Show>
        </li>
      }
    >
      <li>
        <button
          type="button"
          class={`btn h-auto! w-full justify-start! border-0 text-left text-xs font-normal ${rowClass}`}
          data-variant="ghost"
          aria-expanded={expanded()}
          title={props.run.title}
          onClick={() => setExpanded((value) => !value)}
        >
          <StepContents
            step={props.run.step}
            target={props.run.target}
            folder={props.run.folder}
            list
          />
          <span
            class="icon-[ph--caret-right] shrink-0 text-muted-foreground"
            classList={{ 'rotate-90': expanded() }}
            aria-hidden="true"
          />
        </button>
        <Show when={expanded()}>
          <ol class="ml-[70px] min-w-0">
            <For each={props.run.steps}>
              {(step) => (
                <li class={rowClass} title={step.label}>
                  <StepContents step={step} nested />
                </li>
              )}
            </For>
          </ol>
        </Show>
      </li>
    </Show>
  );
}

/**
 * `nested` rows sit under their group's icon and verb, so they show only the
 * target. A `list` folder is comma-joined names, read from the start.
 */
function StepContents(props: {
  step: ToolStep;
  target?: string;
  folder?: string;
  list?: boolean;
  nested?: boolean;
}): JSX.Element {
  return (
    <>
      <Show when={!props.nested}>
        <span
          class={`${props.step.icon} shrink-0`}
          classList={{
            'text-special': props.step.special,
            'text-muted-foreground': !props.step.special,
          }}
          aria-hidden="true"
        />
      </Show>
      <Show
        when={!props.step.special}
        fallback={<span class="min-w-0 truncate text-foreground">{props.step.label}</span>}
      >
        <Show when={!props.nested}>
          <span class="w-[38px] shrink-0 truncate text-muted-foreground">{props.step.tool}</span>
        </Show>
        <span
          class="truncate font-mono text-foreground"
          classList={{
            'max-w-[60%] shrink-0': props.step.path || props.target !== undefined,
            'min-w-0 flex-1': !props.step.path && props.target === undefined,
          }}
        >
          {props.target ?? props.step.basename}
        </span>
        <Show when={props.folder ?? props.step.folder}>
          {(folder) => (
            <Show
              when={!props.list}
              fallback={
                <span class="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  {folder()}
                </span>
              }
            >
              <span class="min-w-0 flex-1 truncate text-left font-mono text-muted-foreground [direction:rtl]">
                <bdi>{folder()}</bdi>
              </span>
            </Show>
          )}
        </Show>
      </Show>
    </>
  );
}

function StepHead(props: { turn: ThreadTurn }): JSX.Element {
  return (
    <Show
      when={props.turn.running}
      fallback={
        <>
          <span
            class="icon-[ph--caret-right] mt-px shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          {props.turn.tools?.length} {props.turn.tools?.length === 1 ? 'step' : 'steps'}
        </>
      }
    >
      <span class="mt-px inline-flex shrink-0">
        <Spiral state="thinking" size={18} />
      </span>
      <span class="line-clamp-2 min-w-0 wrap-anywhere">
        {props.turn.tools?.at(-1) || 'Starting'}
      </span>
    </Show>
  );
}
