import { spawnSync } from 'node:child_process';
import { detectPR, resolveTarget } from './target.ts';
import { dirItem, itemID, type WorkbenchStore } from '../workbench/store.ts';
export function bridge(args: string[]): boolean {
  if (args[0] !== 'acp-mcp-bridge') return false;
  const binary = process.env.FAAH_LEGACY_BIN;
  if (!binary) throw new Error('FAAH_LEGACY_BIN is required until phase 8');
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  return true;
}
export function recordTarget(store: WorkbenchStore, target: string): void {
  const pr = detectPR(target);
  if (pr)
    store.record({
      id: itemID('pr', `${pr.provider}/${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase()),
      kind: 'pr',
      url: pr.url,
      repo: pr.owner + '/' + pr.repo,
      number: pr.number,
      lastOpened: 0,
    });
  else store.record(dirItem(resolveTarget(target).root));
}
export function viewerURL(origin: string, base: string, target?: string): string {
  let result = origin + (base === '/' ? '' : base);
  if (target && !detectPR(target)) {
    const resolved = resolveTarget(target);
    const query = new URLSearchParams();
    if (resolved.line > 0) query.set('line', String(resolved.line));
    if (resolved.file) query.set('path', resolved.file);
    if (query.size) result += '?' + query.toString();
  }
  return result;
}
