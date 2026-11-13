import type { Metrics } from '../workspace/decode.ts';
export interface MetricsProps {
  metrics?: (Metrics & { parts?: { name: string; rssBytes: number; cpuUsage: number }[] }) | null;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Popover } from '../lib/Popover.tsx';
import { MetricsSummary } from './MetricsSummary.tsx';
import { fmtBytes, fmtCpu } from './logic.ts';
export function Metrics(): JSX.Element {
  const editor = useEditor();
  return <MetricsPopover metrics={editor.store.state.workspace.metrics} />;
}
export function MetricsPopover(props: MetricsProps): JSX.Element {
  const metrics = () => props.metrics;
  return (
    <Popover
      triggerId="st-metrics"
      triggerClass="btn font-mono desktop:[&>:not(.shell-ico)]:hidden"
      control="status-metrics"
      panelId="metrics-menu"
      gap={6}
      label={<MetricsSummary metrics={metrics()} />}
      accessibleLabel="Process metrics"
    >
      <div data-ui="metrics-stats" class="grid grid-cols-2 gap-6 px-3 pt-2.5 pb-2">
        <div data-ui="metrics-stat" class="flex flex-col">
          <span data-ui="metrics-val" class="text-lg font-semibold tabular-nums leading-tight">
            {fmtBytes(metrics()?.rssBytes)}
          </span>
          <span data-ui="metrics-label" class="text-xs text-muted-foreground">
            Memory
          </span>
        </div>
        <div data-ui="metrics-stat" class="flex flex-col">
          <span data-ui="metrics-val" class="text-lg font-semibold tabular-nums leading-tight">
            {fmtCpu(metrics())}
          </span>
          <span data-ui="metrics-label" class="text-xs text-muted-foreground">
            CPU
          </span>
        </div>
      </div>
      <hr class="border-border" />
      <div
        data-ui="metrics-grid"
        class="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-3 py-2 text-xs"
      >
        <Show when={metrics()?.lspEnabled && metrics()?.lspMemBytes}>
          <span
            data-ui="metrics-label"
            class="min-w-0 truncate text-muted-foreground"
            title="Language servers"
          >
            Language servers
          </span>
          <span data-ui="metrics-val" class="text-right tabular-nums">
            {fmtBytes(metrics()?.lspMemBytes)}
          </span>
        </Show>
        <span
          data-ui="metrics-label"
          class="min-w-0 truncate text-muted-foreground"
          title="Goroutines"
        >
          Goroutines
        </span>
        <span data-ui="metrics-val" class="text-right tabular-nums">
          {metrics()?.goroutines || 0}
        </span>
      </div>
      <Show when={(metrics()?.parts?.length || 0) > 1}>
        <hr class="border-border" />
        <div
          data-ui="metrics-grid"
          class="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-3 py-2 text-xs"
        >
          <For each={metrics()?.parts}>
            {(part) => (
              <>
                <span
                  data-ui="metrics-label"
                  class="min-w-0 truncate text-muted-foreground"
                  title={part.name}
                >
                  {part.name}
                </span>
                <span data-ui="metrics-val" class="text-right tabular-nums">
                  {fmtBytes(part.rssBytes)} · {fmtCpu(part)}
                </span>
              </>
            )}
          </For>
        </div>
      </Show>
    </Popover>
  );
}
