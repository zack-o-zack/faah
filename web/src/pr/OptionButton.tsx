import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

// Native buttons keep disabled reasons and focus behavior consistent in both pickers.
export function OptionButton(props: {
  selected: boolean;
  label: string;
  icon?: string;
  hint?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}): JSX.Element {
  function handleKeys(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    if (!(event.currentTarget instanceof HTMLButtonElement)) return;
    const group = event.currentTarget.closest('[role="radiogroup"]');
    if (!group) return;
    const options = [
      ...group.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]:not(:disabled):not([aria-disabled="true"])',
      ),
    ];
    const index = options.indexOf(event.currentTarget);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    let next =
      (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + options.length) %
      options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    options[next]?.click();
    options[next]?.focus();
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      aria-label={props.label}
      tabindex={props.selected ? 0 : -1}
      onKeyDown={handleKeys}
      disabled={props.disabled}
      title={props.title}
      onClick={() => props.onClick()}
      class="btn h-auto min-h-8 min-w-max flex-auto justify-center whitespace-nowrap text-left"
      data-variant="outline"
      data-size="sm"
    >
      <Show when={props.icon}>
        <span
          class={`${props.icon} shrink-0`}
          style={{ color: props.selected ? 'inherit' : undefined }}
          aria-hidden="true"
        />
      </Show>
      <span class="flex min-w-0 flex-col gap-1">
        <span class="whitespace-nowrap">{props.label}</span>
        <Show when={props.hint}>
          <span
            class="whitespace-normal text-xs font-normal text-muted-foreground"
            style={{ color: props.selected ? 'inherit' : undefined }}
          >
            {props.hint}
          </span>
        </Show>
      </span>
    </button>
  );
}
