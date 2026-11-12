import { For, Show } from 'solid-js';
import { DropdownMenu } from '../lib/DropdownMenu.jsx';
export function MetricsMenu(props) {
  return (
    <DropdownMenu label="Process metrics">
      <div class="p-2">
        CPU {props.metrics?.cpuUsage?.toFixed(1) ?? '--'}% · RAM{' '}
        {props.metrics ? Math.round(props.metrics.rssBytes / 1048576) : '--'} MB
        <Show when={props.metrics?.lspMemBytes}>
          {' '}
          · LSP {Math.round(props.metrics.lspMemBytes / 1048576)} MB
        </Show>
        <p>Goroutines {props.metrics?.goroutines ?? 0}</p>
        <For each={props.metrics?.parts || []}>
          {(part) => (
            <p>
              {part.name}: {Math.round((part.rssBytes || 0) / 1048576)} MB ·{' '}
              {(part.cpuUsage || 0).toFixed(1)}%
            </p>
          )}
        </For>
      </div>
    </DropdownMenu>
  );
}
