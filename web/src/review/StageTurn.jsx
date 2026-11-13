import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Markdown } from '../lib/Markdown.tsx';
// The first turn holds the stage's own instructions, folded away; follow-ups read like a chat.
export function StageTurn(props) {
  const editor = useEditor();
  const open = (target) => void editor.actions.openReviewReference(target);
  return (
    <>
      <Show
        when={props.first}
        fallback={
          <div class="ml-8 min-w-0 self-end rounded-lg bg-muted px-3 py-2 text-sm">
            <Markdown text={props.turn.prompt} onOpen={open} />
          </div>
        }
      >
        <details class="group/instr rounded-md border px-3 py-2 text-xs text-muted-foreground">
          <summary class="flex cursor-pointer list-none items-center gap-1.5">
            <span
              class="icon-[lucide--chevron-right] size-3 shrink-0 group-open/instr:rotate-90"
              aria-hidden="true"
            />
            Instructions sent to the harness
          </summary>
          <div class="mt-2">
            <Markdown text={props.turn.prompt} onOpen={open} />
          </div>
        </details>
      </Show>
      <Show when={props.turn.reply || props.turn.running}>
        <div class="flex min-w-0 flex-col gap-2">
          <span class="flex items-center gap-1.5 text-xs font-medium text-special">
            <span class="icon-[lucide--sparkle] size-3 shrink-0" aria-hidden="true" />
            {props.turn.model || 'Coding harness'}
          </span>
          <Show when={props.turn.tools?.length}>
            <details class="group/steps text-xs text-muted-foreground">
              <summary class="flex cursor-pointer list-none items-center gap-1.5">
                <span
                  class="icon-[lucide--chevron-right] size-3 shrink-0 group-open/steps:rotate-90"
                  aria-hidden="true"
                />
                {props.turn.tools.length} step{props.turn.tools.length === 1 ? '' : 's'}
              </summary>
              <ul class="mt-1 flex flex-col gap-0.5 pl-4">
                <For each={props.turn.tools}>{(tool) => <li class="truncate">{tool}</li>}</For>
              </ul>
            </details>
          </Show>
          <Show
            when={props.turn.reply}
            fallback={
              <span class="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <span
                  class="icon-[lucide--loader-circle] size-3.5 animate-spin"
                  aria-hidden="true"
                />
                Reading the changes…
              </span>
            }
          >
            <div class="text-sm">
              <Markdown text={props.turn.reply} onOpen={open} />
            </div>
          </Show>
        </div>
      </Show>
      <Show when={props.turn.error}>
        <div class="alert p-3 font-mono whitespace-pre-wrap text-destructive wrap-anywhere">
          Error: {props.turn.error}
        </div>
      </Show>
    </>
  );
}
