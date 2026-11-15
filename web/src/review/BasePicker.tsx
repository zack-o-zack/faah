import type { JSX } from 'solid-js';
import type { ReviewBases } from './types.ts';
import {
  createMemo,
  createResource,
  createSignal,
  createUniqueId,
  For,
  onMount,
  Show,
} from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { filterByText, moveListIndex, scrollToItem } from '../lib/list.ts';
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
                <span class="icon-[lucide--loader-circle] size-4 animate-spin" aria-hidden="true" />
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
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  let input: HTMLInputElement | undefined;
  let command: HTMLDivElement | undefined;
  onMount(() => input?.focus());
  const suggestions = createMemo(() => baseSuggestions(props.bases));
  const branches = createMemo(() =>
    filterByText(
      props.bases.branches.filter((branch) => branch.name !== props.bases.current),
      query(),
      (branch) => branch.name,
    ),
  );
  const rows = createMemo(() => [
    ...suggestions().map((suggestion) => ({ ...suggestion, suggestion: true })),
    ...branches().map((branch) => ({ value: branch.name, label: branch.name, suggestion: false })),
  ]);
  const rowId = (value: string, suggestion: boolean) =>
    `${id}-${suggestion ? 'suggestion' : 'branch'}-${value}`;
  const activeId = () => {
    const active = rows()[selected()];
    return active ? rowId(active.value, active.suggestion) : undefined;
  };
  function move(delta: number) {
    setSelected(moveListIndex(selected(), delta, rows().length));
    const row = command?.querySelector<HTMLElement>('[data-selected="true"]');
    const menu = row?.closest<HTMLElement>('[role="menu"]');
    if (row && menu)
      menu.scrollTop = scrollToItem(
        menu.scrollTop,
        menu.clientHeight,
        row.offsetTop - menu.offsetTop,
        row.offsetHeight,
      );
  }
  const pick = (value: string) => {
    review.actions.setComparisonBase(value);
    props.close();
  };
  const row = (value: string, label: string, hint?: string, suggestion = false) => (
    <button
      type="button"
      role="menuitem"
      id={rowId(value, suggestion)}
      data-filter={value}
      data-checked={review.state.base === value}
      data-selected={activeId() === rowId(value, suggestion)}
      title={hint}
      onClick={() => pick(value)}
    >
      <span>{label}</span>
      <Show when={suggestion}>
        <span class="ml-auto font-mono text-muted-foreground">{value}</span>
      </Show>
      <Show when={review.state.base === value}>
        <span class="icon-[lucide--check] size-4" aria-hidden="true" />
      </Show>
    </button>
  );
  return (
    <div class="command" ref={command}>
      <div role="menu" aria-label="Comparison bases">
        <div role="group" aria-label="Suggestions">
          <For each={suggestions()}>
            {(suggestion) => row(suggestion.value, suggestion.label, suggestion.hint, true)}
          </For>
        </div>
      </div>
      <hr role="separator" />
      <header>
        <input
          ref={input}
          class="input"
          type="search"
          aria-label="Search branches"
          aria-controls={`${id}-branches`}
          aria-activedescendant={activeId()}
          placeholder="Search branches…"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(1);
            else if (event.key === 'ArrowUp') move(-1);
            else if (event.key === 'Home') move(-rows().length);
            else if (event.key === 'End') move(rows().length);
            else if (event.key === 'Enter') {
              const active = rows()[selected()];
              if (active) pick(active.value);
            } else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </header>
      <div
        id={`${id}-branches`}
        role="menu"
        class="max-h-80"
        data-empty="No matching branches"
        aria-label="Branches"
      >
        <For each={[false, true]}>
          {(remote) => (
            <div role="group" aria-label={remote ? 'Remote' : 'Local'}>
              <div role="heading" aria-level="3">
                {remote ? 'Remote' : 'Local'}
              </div>
              <For each={branches().filter((branch) => branch.remote === remote)}>
                {(branch) => row(branch.name, branch.name)}
              </For>
            </div>
          )}
        </For>
        <Show when={!branches().length}>
          <span class="sr-only" role="status">
            No matching branches
          </span>
        </Show>
      </div>
    </div>
  );
}
