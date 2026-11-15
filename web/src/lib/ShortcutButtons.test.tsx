import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
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
  expect(screen.queryByText(/Enter to send/)).toBeNull();
  expect(screen.queryByText(/to connect, Esc to cancel/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check send shortcuts' }));
});
