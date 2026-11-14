import type { Workbench } from './service.ts';
import { MetricsCollector } from '../metrics/service.ts';
import { decodeMetrics } from '../metrics/decode.ts';
const collector = new MetricsCollector();
export async function workbenchMetrics(wb: Workbench) {
  const self = await collector.collect();
  const parts = [{ name: 'workbench', ...self }];
  const children = await Promise.all(
    [...wb.children.entries()]
      .filter(([, c]) => c.state === 'running')
      .map(async ([id, c]) => {
        try {
          const response = await fetch((c.child?.origin ?? '') + wb.childBase(id) + 'api/metrics', {
            signal: AbortSignal.timeout(1000),
          });
          const value: unknown = await response.json();
          return { name: wb.store.get(id)?.path ?? id, ...decodeMetrics(value) };
        } catch {
          return undefined;
        }
      }),
  );
  const total = { ...self };
  for (const part of children) {
    if (!part) continue;
    parts.push(part);
    total.rssBytes += part.rssBytes;
    total.cpuUsage += part.cpuUsage;
    total.goroutines += part.goroutines;
    total.lspMemBytes += part.lspMemBytes;
    total.lspEnabled ||= part.lspEnabled;
  }
  return {
    rssBytes: total.rssBytes,
    cpuUsage: total.cpuUsage,
    goroutines: total.goroutines,
    lspEnabled: total.lspEnabled,
    lspMemBytes: total.lspMemBytes,
    parts,
  };
}
