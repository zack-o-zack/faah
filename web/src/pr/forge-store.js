import { createStore } from 'solid-js/store';
import { onCleanup } from 'solid-js';
import { apiPostJson } from '../lib/api.js';
import { toast } from '../lib/toast.jsx';
import { connectedMessage } from './logic.js';

/** @returns {{open:boolean,reason:string,token:string,extra:string,pending:boolean,error:string}} */
function initialState() {
  return { open: false, reason: '', token: '', extra: '', pending: false, error: '' };
}

/**
 * The Connect dialog: a forge token without a restart. The server checks the token
 * against the forge before keeping it, and a running review uses it at once.
 */
export function createForgeStore(editor, options = {}) {
  const app = editor.store;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  let controller;
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
      reply = await post(
        'api/forge/connect',
        { token, extra: state.extra.trim() },
        { signal: controller.signal },
      );
    } catch (error) {
      if (error.name !== 'AbortError')
        set({ pending: false, error: error.message || 'Could not connect' });
      return;
    }
    const label = forge().info.label;
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
      setForgeToken: (value) => set('token', value),
      setForgeExtra: (value) => set('extra', value),
    },
  };
}
