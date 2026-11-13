import type { JSX } from 'solid-js';
interface ReviewDialogFooterProps {
  prefix: string;
  hint: string;
  confirm: string;
  disabled: boolean;
  onClose: () => void;
  onConfirm: () => unknown;
  children?: JSX.Element;
}
export function ReviewDialogFooter(props: ReviewDialogFooterProps): JSX.Element {
  return (
    <footer class="flex-row! items-center gap-2">
      {props.children}
      <span id={`${props.prefix}-hint`} data-ui="agent-hint" class="flex-1">
        {props.hint}
      </span>
      <button
        id={`${props.prefix}-cancel`}
        type="button"
        class="btn"
        data-control="bar-action"
        data-variant="ghost"
        data-size="xs"
        onClick={() => props.onClose()}
      >
        Cancel
      </button>
      <button
        id={`${props.prefix}-${props.prefix === 'forge-connect' ? 'submit' : 'confirm'}`}
        type="button"
        class="btn"
        data-control="bar-action pr-btn-merge"
        data-variant="primary"
        data-size="xs"
        disabled={props.disabled}
        onClick={() => props.onConfirm()}
      >
        {props.confirm}
      </button>
    </footer>
  );
}
