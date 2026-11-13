import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createAgentStore } from './store.js';
function fixture(options = {}) {
  let agents, dispose;
  createRoot((release) => {
    dispose = release;
    const app = createAppStore();
    const editor = { store: app, actions: { ...app.actions, setSelection: vi.fn() } };
    agents = createAgentStore(editor, options);
  });
  return { agents, dispose };
}
test('edit targets derive from sessions, overlap is rejected, and removal clears highlights', () => {
  const { agents, dispose } = fixture();
  const id = agents.actions.openAgentEdit({ path: 'one.go', l1: 2, l2: 4 });
  agents.actions.openAgentEdit({ path: 'one.go', l1: 4, l2: 6 });
  expect(agents.state.sessions).toHaveLength(1);
  expect(agents.targets()).toEqual([{ id, path: 'one.go', l1: 2, l2: 4 }]);
  agents.actions.closeAgentEdit(id);
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
  let finish, signal;
  const post = vi.fn((_, params, opts) => {
    signal = opts.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const { agents, dispose } = fixture({ post });
  const id = agents.actions.openAgentEdit({ path: 'one.go', l1: 1, l2: 1 });
  agents.actions.setAgentInstruction(id, 'Change the return value');
  const first = agents.actions.applyAgentEdit(id);
  await agents.actions.applyAgentEdit(id);
  expect(post).toHaveBeenCalledOnce();
  expect(agents.state.sessions[0].pending).toBe(true);
  dispose();
  expect(signal.aborted).toBe(true);
  finish({ id: 1, threadId: 'one' });
  await first;
});
