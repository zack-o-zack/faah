import type { JSX } from 'solid-js';
import type { Diagnostic } from './decode.ts';
import { Show } from 'solid-js';
export function HoverDiagnostic(props: { diagnostic: Diagnostic }): JSX.Element {
  const error = () => (props.diagnostic.severity || 1) === 1;
  return (
    <div data-ui="diag" class="flex gap-2 border-b px-3 py-2 text-xs">
      <span
        class={`${error() ? 'icon-[lucide--circle-x] text-destructive' : 'icon-[lucide--triangle-alert] text-warn'} mt-px size-3.5 shrink-0`}
        aria-hidden="true"
      />
      <span class="min-w-0 whitespace-pre-wrap wrap-anywhere">
        {props.diagnostic.message}
        <Show when={props.diagnostic.source}>
          {' '}
          <span class="text-muted-foreground">
            {props.diagnostic.source}
            {props.diagnostic.code ? ' ' + props.diagnostic.code : ''}
          </span>
        </Show>
      </span>
    </div>
  );
}
