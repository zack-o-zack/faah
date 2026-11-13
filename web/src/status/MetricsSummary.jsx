import { Show } from 'solid-js';
import { fmtBytes, fmtCpu } from './logic.ts';
export function MetricsSummary(props) {
  return (
    <span class="inline-flex gap-1 font-mono text-xs">
      <span class="metric-label">CPU</span> <span id="st-cpu">{fmtCpu(props.metrics)}</span> ·{' '}
      <span class="metric-label">RAM</span>{' '}
      <span id="st-ram">{fmtBytes(props.metrics?.rssBytes)}</span>
      <Show when={props.metrics?.lspEnabled}>
        {' '}
        · <span id="st-lspmem">LSP {fmtBytes(props.metrics.lspMemBytes)}</span>
      </Show>
    </span>
  );
}
