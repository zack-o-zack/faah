import type { CallNode, ServerInfo } from './decode.ts';
import type { WordPosition } from '../editor/contracts.ts';
export interface Target {
  word: string;
  path?: string;
  line?: number;
  col?: number;
  imprecise?: boolean;
}
function isPosition(value: unknown): value is WordPosition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'word' in value &&
    typeof value.word === 'string' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'line' in value &&
    typeof value.line === 'number' &&
    'col' in value &&
    typeof value.col === 'number'
  );
}
export function positionNow(
  document: { path: string; cur: number } | null,
  navigation: { at?: unknown },
  word: string,
): Target | null {
  if (!document) return null;
  if (isPosition(navigation.at) && navigation.at.word && navigation.at.path === document.path)
    return navigation.at;
  return word ? { word, path: document.path, line: document.cur, col: 0, imprecise: true } : null;
}
export const canAskServer = (at: Target | null, state: string): boolean =>
  !!at && !at.imprecise && ['ready', 'indexing'].includes(state);
export function callTarget(node: CallNode, direction: string): { path: string; line: number } {
  return direction === 'in' && node.sites?.length
    ? { path: node.sitePath || node.path, line: node.sites[0] || node.line }
    : { path: node.path, line: node.line };
}
export function callIdentity(node: CallNode): string {
  return `${node.path}:${node.line}:${node.name}`;
}
export function isCallCycle(node: CallNode, ancestors: string[]): boolean {
  return ancestors.includes(callIdentity(node));
}
export function shortKind(kind = 'sym'): string {
  const kinds: Record<string, string> = {
    func: 'fn',
    method: 'fn',
    class: 'cls',
    struct: 'str',
    interface: 'int',
    type: 'typ',
    const: 'cst',
    module: 'mod',
    heading: 'h',
  };
  return kinds[kind] || kind.slice(0, 3);
}
export const installLog = (job: { log?: string } | null | undefined): string =>
  (job?.log || '').trimEnd().split('\n').slice(-12).join('\n');

export function shortLanguage(lang: string): string {
  const names: Record<string, string> = {
    'TypeScript and JavaScript': 'TS / JS',
    TypeScript: 'TS',
    JavaScript: 'JS',
    'C and C++': 'C / C++',
  };
  return names[lang] || lang;
}
export function serverPresentation(server: ServerInfo): {
  busy: boolean;
  dot: string;
  note: string;
  action: string;
  label: string;
} {
  if (server.state === 'installing' || server.job?.running)
    return { busy: true, dot: '', note: '', action: '', label: '' };
  if (server.state === 'starting')
    return { busy: true, dot: '', note: '', action: 'stop', label: 'Stop' };
  if (server.running)
    return {
      busy: false,
      dot: server.state === 'indexing' ? 'bg-warn' : 'bg-gi',
      note: '',
      action: 'stop',
      label: 'Stop',
    };
  if (server.state === 'failed')
    return { busy: false, dot: 'bg-gd', note: 'Failed', action: 'start', label: 'Restart' };
  if (server.installed)
    return { busy: false, dot: 'bg-faint', note: '', action: 'start', label: 'Start' };
  let action = '';
  if (server.autoOpt >= 0) action = 'install';
  else if (server.options.length) action = 'copy';
  return {
    busy: false,
    dot: 'bg-faint',
    note: server.error ? 'Install failed' : 'Not installed',
    action,
    label: '',
  };
}
