interface AgentPickerProps {
  id?: string;
  compact?: boolean;
  triggerClass?: string;
  disabled?: boolean;
}
import type { JSX } from 'solid-js';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Popover } from '../lib/Popover.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { filterAgentModels, groupAgentModels } from './logic.ts';
export function AgentPicker(props: AgentPickerProps): JSX.Element {
  const editor = useEditor();
  const agents = editor.agents;
  const [open, setOpen] = createSignal(false);
  const selected = () =>
    agents.state.selected || agents.state.harnesses.find((agent) => agent.installed)?.name || '';
  return (
    <div
      id={props.id}
      class={props.compact ? 'inline-flex min-w-0 flex-1' : 'inline-flex min-w-0 max-w-full'}
      data-control="agent-picker"
      data-placeholder="No harness"
    >
      <Popover
        triggerClass={
          props.triggerClass ||
          (props.compact
            ? 'btn max-w-full h-7! text-muted-foreground! border-transparent! bg-transparent! px-2! text-xs! shadow-none! hover:bg-accent! hover:text-foreground!'
            : 'btn max-w-full')
        }
        variant={props.compact ? 'ghost' : 'outline'}
        size="sm"
        label={
          <>
            <span class="truncate">
              {selected()
                ? selected() + (agents.state.model ? ' · ' + agents.state.model : '')
                : 'No harness'}
            </span>
            <i
              class="icon-[lucide--chevrons-up-down] size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </>
        }
        panelClass="fixed m-0 overflow-hidden rounded-lg border bg-popover p-0 text-popover-foreground shadow-lg z-[70] w-[min(576px,calc(100vw-24px))]"
        accessibleLabel="Coding harness and model"
        disabled={props.disabled || !agents.state.harnesses.some((agent) => agent.installed)}
        open={open()}
        onOpenChange={setOpen}
      >
        <PickerPanel close={() => setOpen(false)} />
      </Popover>
    </div>
  );
}
function PickerPanel(props: { close: () => void }): JSX.Element {
  const editor = useEditor();
  const agents = editor.agents;
  const [query, setQuery] = createSignal('');
  const [chosen, setChosen] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const groups = createMemo(() => groupAgentModels(agents.state.harnesses));
  const active = () =>
    groups().find((group) => group.harness === (chosen() || agents.state.selected)) || groups()[0];
  const [discovered, { refetch }] = createResource(
    () => active()?.harness || false,
    (name) => editor.actions.loadAgentModels(name),
  );
  const models = createMemo(() => {
    const group = active();
    if (!group) return [];
    const models =
      (discovered.error ? [] : discovered()) || group.models.map((model) => model.value);
    return (
      filterAgentModels(
        [{ ...group, models: models.map((model) => ({ value: model, label: model })) }],
        query(),
      )[0]?.models || []
    );
  });
  async function choose(model: string) {
    if (await editor.actions.selectAgent(active()?.harness || '', model)) props.close();
  }
  function move(delta: number) {
    const index = Math.max(0, Math.min(models().length - 1, selected() + delta));
    setSelected(index);
    list?.children[index]?.scrollIntoView({ block: 'nearest' });
  }
  return (
    <div
      class="grid h-[360px] max-h-[calc(100vh-24px)] grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      aria-label="Choose agent and model"
    >
      <nav
        class="min-h-0 min-w-0 overflow-y-auto overscroll-contain border-r bg-sidebar p-1.5"
        aria-label="Agents"
      >
        <For each={groups()}>
          {(group) => (
            <button
              class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-accent aria-selected:text-accent-foreground flex-col items-start! gap-0.5! disabled:opacity-50"
              classList={{
                'bg-primary/10': active()?.harness === group.harness,
                'text-primary-text': active()?.harness === group.harness,
              }}
              aria-pressed={active()?.harness === group.harness}
              disabled={agents.state.pinned && agents.state.selected !== group.harness}
              onClick={() => {
                setChosen(group.harness);
                setQuery('');
                setSelected(0);
                input?.focus();
              }}
            >
              {group.harness}
            </button>
          )}
        </For>
      </nav>
      <section class="min-h-0 overflow-auto p-2">
        <input
          ref={input}
          class="input"
          type="search"
          aria-label="Search models"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(event.key === 'ArrowDown' ? 1 : -1);
            }
            if (event.key === 'Enter' && models()[selected()]) {
              event.preventDefault();
              const model = models()[selected()];
              if (model) void choose(model.value);
            }
          }}
        />
        <p class="p-1 text-xs text-muted-foreground">
          {active()?.harness} models {agents.state.pinned ? '· Harness fixed' : ''}
        </p>
        <Show when={discovered.loading}>
          <p>Loading models…</p>
        </Show>
        <ErrorNotice error={discovered.error?.message}>
          <button class="btn mt-2" data-variant="outline" data-size="sm" onClick={refetch}>
            Retry
          </button>
        </ErrorNotice>
        <div ref={list} role="listbox" aria-label="Models">
          <For each={models()}>
            {(model, index) => (
              <button
                class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer aria-selected:bg-primary/10! aria-selected:text-primary-text!"
                role="option"
                aria-selected={
                  agents.state.selected === active()?.harness && agents.state.model === model.value
                }
                classList={{ 'bg-accent': selected() === index() }}
                onClick={() => void choose(model.value)}
              >
                <span class="min-w-0 flex-1 truncate">{model.label}</span>
                <Show
                  when={
                    agents.state.selected === active()?.harness &&
                    agents.state.model === model.value
                  }
                >
                  <span class="icon-[lucide--check] size-3.5 shrink-0" aria-hidden="true" />
                </Show>
              </button>
            )}
          </For>
        </div>
        <Show when={!discovered.loading && !models().length}>
          <p>No matching models.</p>
          <button class="btn" data-variant="ghost" data-size="xs" onClick={() => void choose('')}>
            Use harness default
          </button>
        </Show>
        <ErrorNotice error={agents.state.error} />
      </section>
    </div>
  );
}
