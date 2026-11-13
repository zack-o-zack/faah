import type { JSX } from 'solid-js';
interface ReviewDialogHeaderProps {
  prefix: string;
  title: string;
  children: JSX.Element;
  onClose: () => void;
}
export function ReviewDialogHeader(props: ReviewDialogHeaderProps): JSX.Element {
  return (
    <header class="flex-row! items-start justify-between">
      <h2 id={`${props.prefix}-title`}>{props.title}</h2>
      <span
        id={props.prefix === 'forge-connect' ? 'forge-connect-host' : 'pr-merge-refs'}
        data-ui="pr-merge-refs"
        class="text-muted-foreground"
      >
        {props.children}
      </span>
      <button
        id={`${props.prefix}-close`}
        type="button"
        title="Close (Esc)"
        aria-label="Close (Esc)"
        class="btn"
        data-control="git-notice-close"
        data-variant="ghost"
        data-size="icon-xs"
        onClick={() => props.onClose()}
      >
        <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
      </button>
    </header>
  );
}
