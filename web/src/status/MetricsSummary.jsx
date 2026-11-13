import { Show } from 'solid-js';
import { fmtBytes, fmtCpu } from './logic.ts';
export function MetricsSummary(props) {
  return (
    <>
      <span
        class="icon-[lucide--activity] size-3.5 shrink-0 shell-ico hidden desktop:block"
        aria-hidden="true"
      />
      <span class="metric">
        <span class="metric-label">CPU</span> <span id="st-cpu">{fmtCpu(props.metrics)}</span>
      </span>
      <span class="metric-divider text-muted-foreground">·</span>
      <span class="metric">
        <span class="metric-label">RAM</span>{' '}
        <span id="st-ram">{fmtBytes(props.metrics?.rssBytes)}</span>
      </span>
      <Show when={props.metrics?.lspEnabled}>
        <span id="st-lspmem-wrap" class="status-metrics-group inline-flex items-center gap-2">
          <span class="metric-divider text-muted-foreground">·</span>
          <span class="metric">
            <span class="metric-label">LSP</span>{' '}
            <span id="st-lspmem">{fmtBytes(props.metrics.lspMemBytes)}</span>
          </span>
        </span>
      </Show>
    </>
  );
}
