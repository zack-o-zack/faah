import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Popover } from '../lib/Popover.jsx';
import { MetricsSummary } from './MetricsSummary.jsx';
import { fmtBytes, fmtCpu } from './logic.ts';
export function Metrics() {
  const editor = useEditor();
  const metrics = () => editor.store.state.workspace.metrics;
  return (
    <Popover
      triggerId="st-metrics"
      label={<MetricsSummary metrics={metrics()} />}
      accessibleLabel="Process metrics"
    >
      <div id="metrics-menu" class="flex flex-col gap-2 p-2 text-xs">
        <strong>
          {fmtBytes(metrics()?.rssBytes)} · {fmtCpu(metrics())}
        </strong>
        <p>Goroutines {metrics()?.goroutines || 0}</p>
        <Show when={metrics()?.lspEnabled}>
          <p>Language servers {fmtBytes(metrics()?.lspMemBytes)}</p>
        </Show>
        <For each={metrics()?.parts}>
          {(part) => (
            <p>
              {part.name}: {fmtBytes(part.rssBytes)} · {fmtCpu(part)}
            </p>
          )}
        </For>
      </div>
    </Popover>
  );
}
