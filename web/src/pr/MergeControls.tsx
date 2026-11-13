import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { DropdownMenu } from '../lib/DropdownMenu.tsx';
import { mergeMethodInfo } from './logic.ts';
// A split button: the last-used method, and a caret to pick another.
export function MergeControls(): JSX.Element {
  const editor = useEditor();
  const merge = editor.merge;
  const method = () => mergeMethodInfo(merge.method());
  return (
    <div id="pr-merge-group" class="relative flex flex-none gap-px">
      <button
        id="pr-merge"
        type="button"
        class="btn"
        data-variant="primary"
        data-size="sm"
        disabled={merge.sync().running || merge.state.pending}
        title={
          merge.sync().running
            ? 'Wait for the rebase to finish'
            : `${method().label} into ${merge.base()} (review the commit first)`
        }
        onClick={() => void editor.actions.openMergeDialog(merge.method())}
      >
        {merge.sync().running ? 'Rebasing...' : method().button}
      </button>
      <DropdownMenu
        triggerId="pr-merge-caret"
        accessibleLabel="Choose how to merge"
        disabled={merge.sync().running}
        label={<span class="icon-[lucide--chevron-down] size-3.5" aria-hidden="true" />}
      >
        <div class="flex w-[min(22rem,90vw)] flex-col">
          <For each={merge.allowed()}>
            {(value) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={value === merge.method()}
                class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left whitespace-normal hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => editor.actions.chooseMergeMethod(value)}
              >
                <span class="mt-0.5 flex size-4 flex-none items-center justify-center text-primary-text">
                  <Show when={value === merge.method()}>
                    <span class="icon-[lucide--check] size-3.5" aria-hidden="true" />
                  </Show>
                </span>
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-sm font-medium">{mergeMethodInfo(value).label}</span>
                  <span class="text-xs text-muted-foreground">
                    {mergeMethodInfo(value).explain(merge.commitCount(), merge.base())}
                  </span>
                </span>
              </button>
            )}
          </For>
        </div>
      </DropdownMenu>
    </div>
  );
}
