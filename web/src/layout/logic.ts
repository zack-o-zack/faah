import { record, isRecord } from '../lib/decode.ts';
export const INSPECTOR_TABS: string[] = ['refs', 'symbols', 'calls', 'search'];
export const DEFAULT_LAYOUT: LayoutState = {
  left: true,
  right: false,
  threads: false,
  leftWidth: 340,
  rightWidth: 384,
  threadsWidth: 384,
  inspector: 'refs',
};
export interface LayoutState {
  left: boolean;
  right: boolean;
  threads: boolean;
  leftWidth: number;
  rightWidth: number;
  threadsWidth: number;
  inspector: string;
}
export function readLayout(value: string | null): LayoutState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}');
  } catch {
    parsed = {};
  }
  const input = isRecord(parsed) ? record(parsed) : {};
  const result = { ...DEFAULT_LAYOUT };
  const panels: PanelName[] = ['left', 'right', 'threads'];
  for (const key of panels) if (typeof input[key] === 'boolean') result[key] = input[key];
  const sizes: ['leftWidth' | 'rightWidth' | 'threadsWidth', number, number][] = [
    ['leftWidth', 170, 620],
    ['rightWidth', 200, 700],
    ['threadsWidth', 240, 900],
  ];
  for (const [key, min, max] of sizes) {
    const size = input[key];
    if (typeof size === 'number' && Number.isFinite(size))
      result[key] = Math.max(min, Math.min(max, size));
  }
  const tab = input.inspector;
  if (typeof tab === 'string' && INSPECTOR_TABS.includes(tab)) result.inspector = tab;
  if (result.right) result.threads = false;
  return result;
}

export type PanelName = 'left' | 'right' | 'threads';
