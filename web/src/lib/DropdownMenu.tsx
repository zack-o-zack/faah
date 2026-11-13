import type { JSX } from 'solid-js';
import type { PopoverProps } from './Popover.tsx';
import { Popover } from './Popover.tsx';

export function DropdownMenu(props: PopoverProps): JSX.Element {
  return <Popover {...props} role="menu" />;
}
