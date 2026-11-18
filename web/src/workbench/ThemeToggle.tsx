import type { JSX } from 'solid-js';
import { nextThemeMode, themeMode, themeToggleLabel } from './theme-cycle.ts';

export function ThemeToggle(props: { value: string; onChange: (id: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      class="btn h-7 w-7 rounded-[8px] p-0 text-muted-foreground hover:bg-(--hover)"
      data-variant="ghost"
      data-size="icon-xs"
      aria-label={themeToggleLabel(props.value)}
      title={themeToggleLabel(props.value)}
      onClick={() => props.onChange(nextThemeMode(props.value))}
    >
      <span class={themeMode(props.value).icon} aria-hidden="true" />
    </button>
  );
}
