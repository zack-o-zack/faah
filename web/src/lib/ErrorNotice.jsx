import { For, Show } from 'solid-js';
import { copyText } from './clipboard.js';
export function ErrorNotice(props) {
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
