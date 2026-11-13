interface LineStatsProps {
  additions?: number;
  deletions?: number;
}
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
// +12 −3, leaving out a side with nothing on it.
export function LineStats(props: LineStatsProps): JSX.Element {
  return (
    <Show
      when={props.additions || props.deletions}
      fallback={<span class="text-muted-foreground">no line changes</span>}
    >
      <Show when={props.additions}>
        <span class="font-semibold text-gi">+{props.additions}</span>
      </Show>
      <Show when={props.additions && props.deletions}> </Show>
      <Show when={props.deletions}>
        <span class="font-semibold text-gd">−{props.deletions}</span>
      </Show>
    </Show>
  );
}
