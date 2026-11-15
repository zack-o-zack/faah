import type { JSX } from 'solid-js';
import { ButtonKbd } from '../lib/ButtonKbd.tsx';
interface ReviewDialogFooterProps {
  prefix: string;
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
      <span class="flex-1" />
      <button
        id={`${props.prefix}-cancel`}
        title="Cancel (Esc)"
        aria-keyshortcuts="Escape"
        type="button"
        class="btn"
        data-control="bar-action"
        data-variant="ghost"
        data-size="xs"
        onClick={() => props.onClose()}
      >
        Cancel <ButtonKbd combo="Esc" />
      </button>
      <button
        id={`${props.prefix}-${props.prefix === 'forge-connect' ? 'submit' : 'confirm'}`}
        type="button"
        class="btn"
        data-control="bar-action pr-btn-merge"
        title={`${props.confirm} (Enter)`}
        aria-keyshortcuts="Enter"
        data-variant="primary"
        data-size="xs"
        disabled={props.disabled}
        onClick={() => props.onConfirm()}
      >
        {props.confirm} <ButtonKbd combo="Enter" />
      </button>
    </footer>
  );
}
