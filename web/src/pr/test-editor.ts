import type { AgentJobOptions } from '../agents/jobs.ts';
import { vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { createAppStore } from '../app/store.ts';
import { createPRStore } from './store.ts';
import { createMergeStore } from './merge-store.ts';
import { createForgeStore } from './forge-store.ts';
import { decodeAgentJob } from '../agents/job-decode.ts';
import { isRecord, record } from '../lib/decode.ts';
import type { PRMeta } from './types.ts';
import type { Request } from '../lib/api.ts';
export const prMeta = (fields: Partial<PRMeta> = {}): PRMeta => ({
  number: 7,
  title: 'Fix the parser',
  url: 'https://github.com/o/r/pull/7',
  base: 'main',
  head: 'fix',
  state: 'open',
  writeAccess: true,
  files: { 'a.go': 'M' },
  ...fields,
});
export interface PREditorOptions {
  meta?: PRMeta;
  forge?: unknown;
  request?: Request;
  post?: Request;
}
// A real app store and the three PR slices; the remaining actions are isolated.
export function createPREditor({
  meta = prMeta(),
  forge = null,
  request,
  post,
}: PREditorOptions = {}) {
  const app = createAppStore();
  app.actions.setWorkspace({ name: 'repo', pr: meta, forge });
  const [git] = createStore({ pending: '', sync: { inProgress: '', rewritten: false } });
  const [agents] = createStore({ harnesses: [], selected: '' });
  const baseActions = {
    openSettings: vi.fn(),
    refreshTree: vi.fn(async () => {}),
    setSelection: vi.fn(),
    setReviewMode: vi.fn(),
    openFile: vi.fn(async () => {}),
    centerLine: vi.fn(),
    reloadWorkspace: vi.fn(async () => {}),
    runAgentJob: vi.fn(
      async (_endpoint: string, _params: unknown, _options: AgentJobOptions = {}) =>
        decodeAgentJob({}),
    ),
    resolvePRBase: vi.fn(async () => {}),
    confirmForcePush: vi.fn(),
    openForgeConnect: (reason?: string) => forgeStore.actions.openForgeConnect(reason),
    refreshMergeStatus: () => merge.actions.refreshMergeStatus(),
    refreshPRMeta: () => pr.actions.refreshPRMeta(),
  };
  const editor = {
    store: app,
    git: { state: git },
    agents: { state: agents },
    active: () => null,
    actions: baseActions,
  };
  const options = { request, post };
  const pr = createPRStore(editor, options);
  const merge = createMergeStore(editor, options);
  const forgeStore = createForgeStore(editor, options);
  return {
    ...editor,
    pr,
    merge,
    forge: forgeStore,
    actions: Object.assign(baseActions, pr.actions, merge.actions, forgeStore.actions),
  };
}
type RouteValue =
  | object
  | string
  | number
  | boolean
  | null
  | ((params: Record<string, unknown>, path: string) => unknown);
export function routes(table: Record<string, RouteValue>) {
  return vi.fn(async (path: string, value?: unknown): Promise<unknown> => {
    const key = Object.keys(table).find((prefix) => path.startsWith(prefix));
    if (!key) throw new Error('unexpected ' + path);
    const reply = table[key];
    const result: unknown =
      typeof reply === 'function'
        ? await reply(value === undefined ? {} : record(value), path)
        : structuredClone(reply);
    // Component fixtures name draft IDs with a prefix; the server sends numbers.
    if (path === 'api/pr/comments' && isRecord(result) && Array.isArray(result.comments)) {
      return {
        ...result,
        comments: result.comments.map((item: unknown) => {
          const comment = record(item);
          const id = comment.id;
          return typeof id === 'string' && /^d\d+$/.test(id)
            ? { ...comment, id: 100 + Number(id.slice(1)) }
            : comment;
        }),
      };
    }
    return result;
  });
}
