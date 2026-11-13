import type { AppStore } from '../app/store.ts';
import type { Request } from '../lib/api.ts';
import type { CoreActions } from '../editor/contracts.ts';
import { decodeForgeReply } from './decode.ts';
import { isAbort, errorMessage } from '../lib/decode.ts';
export interface ForgeOptions {
  post?: Request;
}
interface ForgeState {
  open: boolean;
  reason: string;
  token: string;
  extra: string;
  pending: boolean;
  error: string;
}
interface ForgeHost {
  store: AppStore;
  actions: Pick<CoreActions, 'openSettings' | 'refreshPRMeta'>;
}
import { createStore } from 'solid-js/store';
import { onCleanup } from 'solid-js';
import { apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { connectedMessage } from './logic.ts';

function initialState(): ForgeState {
  return { open: false, reason: '', token: '', extra: '', pending: false, error: '' };
}

export function createForgeStore(editor: ForgeHost, options: ForgeOptions = {}) {
  const app = editor.store;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  const forge = () => app.state.workspace.meta?.forge || null;

  function openForgeConnect(reason = '') {
    if (!forge()) {
      editor.actions.openSettings('ui', 'GitHub', 'github.token');
      return;
    }
    set({ ...initialState(), open: true, reason: typeof reason === 'string' ? reason : '' });
  }

  async function submitForgeConnect() {
    const token = state.token.trim();
    if (state.pending) return;
    if (!token) {
      set('error', 'Paste the token first.');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    set({ pending: true, error: '' });
    let reply;
    try {
      reply = decodeForgeReply(
        await post(
          'api/forge/connect',
          { token, extra: state.extra.trim() },
          { signal: controller.signal },
        ),
      );
    } catch (error) {
      if (!isAbort(error))
        set({ pending: false, error: errorMessage(error) || 'Could not connect' });
      return;
    }
    const label = forge()?.info.label || 'forge';
    app.actions.patchWorkspace('forge', {
      ...forge(),
      hasToken: true,
      source: reply.saved ? 'settings' : 'session',
    });
    set({ open: false, pending: false });
    toast(
      'success',
      connectedMessage(label, reply),
      reply.validated && !reply.writeAccess ? 6000 : 3000,
    );
    // A token connected mid-review applies at once: re-read what it unlocks.
    if (app.state.workspace.meta?.pr) await editor.actions.refreshPRMeta();
  }

  return {
    state,
    forge,
    actions: {
      openForgeConnect,
      submitForgeConnect,
      closeForgeConnect() {
        controller?.abort();
        set({ open: false, pending: false });
      },
      setForgeToken: (value: string) => set('token', value),
      setForgeExtra: (value: string) => set('extra', value),
    },
  };
}
