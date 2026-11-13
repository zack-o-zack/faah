import type { JSX } from 'solid-js';

interface MenuItemProps {
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
  checked?: boolean;
  disabled?: boolean;
  class?: string;
  icon?: string;
  onSelect: () => unknown;
  children?: JSX.Element;
}
import { Show } from 'solid-js';
// A menu row for DropdownMenu and ContextMenu panels; both close on selection.
export function MenuItem(props: MenuItemProps): JSX.Element {
  return (
    <button
      type="button"
      role={props.role || 'menuitem'}
      aria-checked={props.checked}
      disabled={props.disabled}
      class={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${props.class || ''}`}
      onClick={() => props.onSelect()}
    >
      <Show when={props.icon}>
        <span class={`${props.icon} size-3.5 shrink-0`} aria-hidden="true" />
      </Show>
      {props.children}
    </button>
  );
}
