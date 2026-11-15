import type { JSX } from 'solid-js';
import type { ReviewBases } from './types.ts';
import { createResource, createSignal, createUniqueId, For, onMount, Show } from 'solid-js';
import 'basecoat-css/basecoat';
import 'basecoat-css/command';
import { useEditor } from '../editor/context.tsx';
import { Popover } from '../lib/Popover.tsx';
import { baseSuggestions } from './logic.ts';

export function BasePicker(props: { label: JSX.Element }): JSX.Element {
  const review = useEditor().review;
  const [open, setOpen] = createSignal(false);
  const [bases] = createResource(open, () => review.actions.loadBases());
  return (
    <Popover
      triggerId="btn-walkthrough-base"
      triggerTitle="Change what the working tree is compared with"
      accessibleLabel="Change what the working tree is compared with"
      open={open()}
      onOpenChange={setOpen}
      autofocus
      label={
        <>
          {props.label}
          <span class="icon-[lucide--chevron-down] size-3" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <Show
          when={!bases.loading}
          fallback={
            <div class="empty" role="status">
              <header>
                <p>Loading branches…</p>
              </header>
            </div>
          }
        >
          <Show
            when={!bases.error}
            fallback={
              <div class="empty" role="alert">
                <header>
                  <p>Failed to load branches</p>
                </header>
                <button
                  class="btn"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Close
                </button>
              </div>
            }
          >
            <Show when={bases()}>{(data) => <BaseCommand bases={data()} close={close} />}</Show>
          </Show>
        </Show>
      )}
    </Popover>
  );
}

function BaseCommand(props: { bases: ReviewBases; close: () => void }): JSX.Element {
  const review = useEditor().review;
  const id = createUniqueId();
  let command: HTMLDivElement | undefined;
  onMount(() => {
    window.basecoat.init('command');
    command?.querySelector<HTMLInputElement>('input')?.focus();
  });
  const pick = (value: string) => {
    review.actions.setComparisonBase(value);
    props.close();
  };
  const branches = (remote: boolean) =>
    props.bases.branches.filter(
      (branch) => branch.remote === remote && branch.name !== props.bases.current,
    );
  const row = (value: string, label: string, hint?: string, force = false) => (
    <button
      type="button"
      role="menuitem"
      id={`${id}-${force ? 'suggestion' : 'branch'}-${value}`}
      data-filter={value}
      data-force={force ? '' : undefined}
      data-checked={review.state.base === value}
      title={hint}
      onClick={() => pick(value)}
    >
      <span>{label}</span>
      <Show when={force}>
        <span class="ml-auto font-mono text-muted-foreground">{value}</span>
      </Show>
      <span data-indicator class="icon-[lucide--check] size-4" aria-hidden="true" />
    </button>
  );
  return (
    <div class="command" ref={command}>
      <div role="menu" class="max-h-80" aria-label="Comparison bases">
        <div role="group" aria-label="Suggestions">
          <For each={baseSuggestions(props.bases)}>
            {(suggestion) => row(suggestion.value, suggestion.label, suggestion.hint, true)}
          </For>
        </div>
        <hr role="separator" />
        <header>
          <input
            class="input"
            type="search"
            aria-label="Search branches"
            placeholder="Search branches…"
          />
        </header>
        <div role="menu" data-empty="No matching branches" aria-label="Branches">
          <For each={[false, true]}>
            {(remote) => (
              <div role="group" aria-label={remote ? 'Remote' : 'Local'}>
                <div role="heading" aria-level="3">
                  {remote ? 'Remote' : 'Local'}
                </div>
                <For each={branches(remote)}>{(branch) => row(branch.name, branch.name)}</For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
