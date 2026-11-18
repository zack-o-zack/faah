import type { JSX } from 'solid-js';
import { Mark } from './Mark.tsx';

interface BrandProps {
  size?: 'chrome' | 'welcome';
}

export function Brand(props: BrandProps): JSX.Element {
  return (
    <span
      class={
        props.size === 'welcome'
          ? 'inline-flex shrink-0 items-center gap-4 text-foreground'
          : 'inline-flex shrink-0 items-center gap-2 text-foreground'
      }
      role="img"
      aria-label="fibo"
    >
      <Mark size={props.size === 'welcome' ? 56 : 18} />
      <span
        aria-hidden="true"
        class={
          props.size === 'welcome'
            ? 'font-display lowercase text-[56px] leading-[60px] font-semibold tracking-[-0.03em]'
            : 'font-display lowercase text-15 leading-5 font-semibold'
        }
      >
        fibo
      </span>
    </span>
  );
}
