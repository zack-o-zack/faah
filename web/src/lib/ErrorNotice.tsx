import type { JSX } from 'solid-js';

interface ErrorNoticeProps {
  error: string;
  streams?: string[][];
  children?: JSX.Element;
}
import { For, Show } from 'solid-js';
import { copyText } from './clipboard.ts';
export function ErrorNotice(props: ErrorNoticeProps): JSX.Element {
  return (
    <Show when={props.error}>
      <div role="alert" class="rounded border border-destructive p-2 text-xs text-destructive">
        <p class="whitespace-pre-wrap">{props.error}</p>
        <For each={props.streams || []}>
          {(stream) => (
            <Show when={stream[1]}>
              <details>
                <summary>{stream[0]}</summary>
                <pre class="max-h-60 overflow-auto whitespace-pre-wrap">{stream[1]}</pre>
              </details>
            </Show>
          )}
        </For>
        <button class="btn" onClick={() => void copyText(props.error)}>
          Copy error
        </button>
        {props.children}
      </div>
    </Show>
  );
}
