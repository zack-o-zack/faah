import type { Child } from '../legacy/child.ts';
import { decodeMetrics } from './decode.ts';
import { MetricsCollector } from './service.ts';
export async function workspaceMetrics(options: {
  collector: MetricsCollector;
  child: Child | undefined;
  base: string;
  lspEnabled: boolean;
}) {
  const { collector, child, base, lspEnabled } = options;
  const metrics = await collector.collect(
    child?.process.pid ? [child.process.pid] : [],
    lspEnabled,
  );
  if (child) {
    try {
      const response = await fetch(child.origin + base + 'api/metrics', {
        signal: AbortSignal.timeout(1000),
      });
      const value: unknown = await response.json();
      const legacy = decodeMetrics(value);
      metrics.lspMemBytes = legacy.lspMemBytes;
      metrics.lspEnabled = legacy.lspEnabled;
    } catch {
      /* A closing legacy process may no longer answer metrics. */
    }
  }
  return metrics;
}
