import { record, number } from '../decode.ts';
import type { Metrics } from './service.ts';
export function decodeMetrics(value: unknown): Metrics {
  const v = record(value);
  if (typeof v.lspEnabled !== 'boolean') throw new Error('invalid lspEnabled');
  return {
    rssBytes: number(v.rssBytes),
    peakRSSBytes: number(v.peakRSSBytes),
    cpuUsage: number(v.cpuUsage),
    goroutines: number(v.goroutines),
    lspEnabled: v.lspEnabled,
    lspMemBytes: number(v.lspMemBytes),
  };
}
