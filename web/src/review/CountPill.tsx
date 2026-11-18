import type { JSX } from 'solid-js';

/** One count pill for review tabs and their file-group chips. */
export function CountPill(props: { value: number | string }): JSX.Element {
  return (
    <span class="rounded-full bg-(--hover) px-1.5 text-11 leading-4 tabular-nums text-muted-foreground">
      {props.value}
    </span>
  );
}
