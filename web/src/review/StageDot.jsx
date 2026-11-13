import { STAGE_STATUS } from './logic.ts';
export function StageDot(props) {
  return (
    <span
      class={`size-2 shrink-0 rounded-full ${STAGE_STATUS[props.status]?.dot || STAGE_STATUS.pending.dot} ${props.class || ''}`}
      aria-hidden="true"
    />
  );
}
