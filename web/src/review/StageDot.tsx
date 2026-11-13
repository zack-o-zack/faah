interface StageDotProps {
  status: string;
  class?: string;
}
import type { JSX } from 'solid-js';
import { STAGE_STATUS, stageStatus } from './logic.ts';
export function StageDot(props: StageDotProps): JSX.Element {
  return (
    <span
      class={`size-2 shrink-0 rounded-full ${STAGE_STATUS[stageStatus({ status: props.status })].dot || STAGE_STATUS.pending.dot} ${props.class || ''}`}
      aria-hidden="true"
    />
  );
}
