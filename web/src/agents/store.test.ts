import type { AgentOptions } from './store.ts';
import type { RequestOptions } from '../lib/api.ts';
import { required } from '../lib/test-values.ts';
import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createAgentStore } from './store.ts';
function fixture(options: AgentOptions = {}) {
  return createRoot((dispose) => {
    const app = createAppStore();
    const editor = {
      store: app,
      actions: {
        ...app.actions,
        setSelection: vi.fn(),
        refreshTree: vi.fn(async () => {}),
        reloadOpenTabs: vi.fn(async () => {}),
        openFile: vi.fn(async () => {}),
      },
    };
    const agents = createAgentStore(editor, options);
    return { agents, dispose };
  });
}
test('edit targets derive from sessions, overlap is rejected, and removal clears highlights', () => {
  const { agents, dispose } = fixture();
  const id = agents.actions.openAgentEdit({ path: 'one.go', l1: 2, l2: 4 });
  agents.actions.openAgentEdit({ path: 'one.go', l1: 4, l2: 6 });
  expect(agents.state.sessions).toHaveLength(1);
  expect(agents.targets()).toEqual([{ id, path: 'one.go', l1: 2, l2: 4 }]);
  agents.actions.closeAgentEdit(required(id));
  expect(agents.targets()).toEqual([]);
  dispose();
});
test('browsing models deduplicates requests without persisting a selection', async () => {
  const post = vi.fn();
  const request = vi.fn().mockResolvedValue({ models: ['provider/model'] });
  const { agents, dispose } = fixture({ request, post });
  await Promise.all([
    agents.actions.loadAgentModels('agent'),
    agents.actions.loadAgentModels('agent'),
  ]);
  expect(request).toHaveBeenCalledOnce();
  expect(post).not.toHaveBeenCalled();
  expect(agents.state.selected).toBe('');
  dispose();
});
test('edit submission is guarded while pending and disposal cancels late responses', async () => {
  let finish: (value: unknown) => void = () => {
    throw new Error('Missing request');
  };
  let signal: AbortSignal | null | undefined;
  const post = vi.fn((_path: string, _params: unknown, opts?: RequestOptions) => {
    signal = opts?.signal;
    return new Promise<unknown>((resolve) => {
      finish = resolve;
    });
  });
  const { agents, dispose } = fixture({ post });
  const id = agents.actions.openAgentEdit({ path: 'one.go', l1: 1, l2: 1 });
  agents.actions.setAgentInstruction(required(id), 'Change the return value');
  const first = agents.actions.applyAgentEdit(required(id));
  await agents.actions.applyAgentEdit(required(id));
  expect(post).toHaveBeenCalledOnce();
  expect(agents.state.sessions[0]?.pending).toBe(true);
  dispose();
  expect(signal?.aborted).toBe(true);
  finish({ id: 1, threadId: 'one' });
  await first;
});
