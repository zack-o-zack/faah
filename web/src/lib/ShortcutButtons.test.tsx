import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { SelectionBar } from '../editor/SelectionBar.tsx';
import { keyCaps } from './keyboard.ts';
import { required } from './test-values.ts';
import { ReviewCompose } from '../review/ReviewCompose.tsx';
import { ThreadDetail } from '../threads/ThreadDetail.tsx';
import { ForgeConnectDialog } from '../pr/ForgeConnectDialog.tsx';

test('visible Send and Connect actions carry chips; only the newline hint remains', () => {
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({
      forge: { info: { label: 'GitHub' }, setup: { steps: [], env: 'GITHUB_TOKEN' } },
    });
    const editor = createEditorStore(app);
    const followup = vi.spyOn(editor.actions, 'sendReviewFollowup').mockResolvedValue();
    const thread = vi.spyOn(editor.actions, 'sendThread').mockResolvedValue();
    editor.actions.openForgeConnect();
    return (
      <EditorProvider value={editor}>
        <ReviewCompose />
        <ThreadDetail />
        <ForgeConnectDialog />
        <button
          onClick={() => {
            fireEvent.keyDown(required(document.getElementById('review-compose-input')), {
              key: 'Enter',
            });
            fireEvent.keyDown(required(document.getElementById('thr-input')), { key: 'Enter' });
            expect(followup).toHaveBeenCalledOnce();
            expect(thread).toHaveBeenCalledOnce();
          }}
        >
          Check send shortcuts
        </button>
      </EditorProvider>
    );
  });
  for (const id of [
    'review-compose-send',
    'thr-send',
    'forge-connect-submit',
    'forge-connect-cancel',
  ]) {
    expect(document.querySelector(`#${id} kbd`)).not.toBeNull();
    expect(required(document.getElementById(id)).getAttribute('aria-keyshortcuts')).toBeTruthy();
  }
  for (const id of ['review-compose-send', 'thr-send']) {
    expect(document.getElementById(id)?.getAttribute('data-variant')).toBe('send');
  }
  expect(screen.queryByText(/Enter to send/)).toBeNull();
  expect(screen.queryByText(/to connect, Esc to cancel/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check send shortcuts' }));
});

test('selection menu shortcuts use the shared shortcut slot with separate caps', () => {
  render(() => {
    const app = createAppStore();
    const editor = createEditorStore(app);
    editor.actions.openSelectionMenu({ path: 'main.go', text: 'source', l1: 1, l2: 1 }, 20, 20);
    return (
      <EditorProvider value={editor}>
        <SelectionBar />
      </EditorProvider>
    );
  });
  const menu = screen.getByRole('menu');
  for (const [action, combo] of [
    ['thread', 'Alt+T'],
    ['copy-source', 'Mod+C'],
  ] as const) {
    const item = required(menu.querySelector(`[data-sel="${action}"]`));
    const slot = required(item.querySelector('span[data-shortcut]'));
    expect([...slot.querySelectorAll('kbd')].map((cap) => cap.textContent)).toEqual(keyCaps(combo));
    expect(slot.querySelectorAll(':scope > kbd').length).toBe(2);
    expect(item.querySelector('kbd > kbd')).toBeNull();
  }
});

test('the running thread keeps its stop action as a normal primary button', () => {
  const cancel = vi.fn();
  render(() => {
    const editor = createEditorStore(createAppStore());
    vi.spyOn(editor.threads, 'running').mockReturnValue(true);
    vi.spyOn(editor.actions, 'cancelThread').mockImplementation(cancel);
    return (
      <EditorProvider value={editor}>
        <ThreadDetail />
      </EditorProvider>
    );
  });
  const stop = screen.getByRole('button', { name: 'Stop this reply' });
  expect(stop.getAttribute('data-variant')).toBe('primary');
  fireEvent.click(stop);
  expect(cancel).toHaveBeenCalledOnce();
});
