import { decodeItems } from '../workbench/decode.ts';
export function holdingUpdate(
  value: unknown,
  path: string,
): { reload: true } | { reload: false; progress: string | undefined } {
  const items = decodeItems(value);
  const item = items.find((item) => item.href === path);
  return !item || item.state !== 'starting'
    ? { reload: true }
    : { reload: false, progress: item.progress };
}
