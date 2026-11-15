import type { JSX } from 'solid-js';
import { keyLabel } from './keyboard.ts';

export function ButtonKbd(props: { combo: string }): JSX.Element {
  return (
    <kbd class="kbd h-5 min-w-5 bg-current/15 px-1 text-current" aria-hidden="true">
      {keyLabel(props.combo)}
    </kbd>
  );
}
