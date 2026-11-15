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
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      aria-label={props.label}
      disabled={props.disabled}
      title={props.title}
      onClick={() => props.onClick()}
      class="btn h-auto min-h-8 min-w-max flex-auto justify-center whitespace-nowrap text-left aria-checked:border-primary aria-checked:bg-primary/15 aria-checked:ring-1 aria-checked:ring-primary aria-checked:relative aria-checked:z-10 disabled:opacity-40"
      data-variant="outline"
      data-size="sm"
    >
      <Show when={props.icon}>
        <span class={`${props.icon} size-4 shrink-0`} aria-hidden="true" />
      </Show>
      <span class="flex min-w-0 flex-col gap-1">
        <span class="whitespace-nowrap">{props.label}</span>
        <Show when={props.hint}>
          <span class="whitespace-normal text-xs font-normal text-muted-foreground">
            {props.hint}
          </span>
        </Show>
      </span>
    </button>
  );
}
