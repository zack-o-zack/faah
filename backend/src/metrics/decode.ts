import { record, number } from '../decode.ts';
import type { Metrics } from './service.ts';

export function decodeMetrics(value: unknown): Metrics {
  const fields = record(value);
  if (typeof fields.lspEnabled !== 'boolean') throw new Error('invalid lspEnabled');
  return {
    rssBytes: number(fields.rssBytes),
    peakRSSBytes: number(fields.peakRSSBytes),
    cpuUsage: number(fields.cpuUsage),
    goroutines: number(fields.goroutines),
    lspEnabled: fields.lspEnabled,
    lspMemBytes: number(fields.lspMemBytes),
  };
}
