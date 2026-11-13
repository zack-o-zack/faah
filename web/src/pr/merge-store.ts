import type { AppStore } from '../app/store.ts';
import type { Request } from '../lib/api.ts';
import type { CoreActions } from '../editor/contracts.ts';
import type { MergeInfo, MergeMessage, SyncContext } from './types.ts';
import { decodeMerge } from './decode.ts';
import { errorMessage, isAbort, isRecord } from '../lib/decode.ts';
export interface MergeOptions {
  request?: Request;
  post?: Request;
}
interface MergeState {
  info: MergeInfo | null;
  pending: boolean;
  error: string;
  remembered: string;
  checkedAt: number;
  dialog: {
    open: boolean;
    method: string;
    drafts: Record<string, MergeMessage>;
    instruction: string;
    rewrite: boolean;
    rewriting: { pending: boolean; seconds: number };
    pending: boolean;
    error: string;
  };
}
interface MergeHost {
  store: AppStore;
  git: { state: { pending: string; sync: SyncContext } };
  actions: Pick<
    CoreActions,
    'runAgentJob' | 'refreshPRMeta' | 'resolvePRBase' | 'confirmForcePush'
  >;
}
import { batch, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import {
  MERGE_METHODS,
  chosenMethod,
  mergePill,
  mergeWarnings,
  reviewGate,
  splitMessage,
} from './logic.ts';

const METHOD_KEY = 'faah.prMergeMethod';
// The forge computes mergeability lazily: right after a push it often says "unknown".
const UNKNOWN_RETRIES = 6;
const UNKNOWN_DELAY = 2500;

function rememberedMethod() {
  try {
    return localStorage.getItem(METHOD_KEY) || '';
  } catch {
    return '';
  }
}

function initialState(): MergeState {
  return {
    info: null,
    pending: false,
    error: '',
    remembered: rememberedMethod(),
    checkedAt: 0,
    dialog: {
      open: false,
      method: 'squash',
      drafts: {},
      instruction: '',
      rewrite: false,
      rewriting: { pending: false, seconds: 0 },
      pending: false,
      error: '',
    },
  };
}

export function createMergeStore(editor: MergeHost, options: MergeOptions = {}) {
  const app = editor.store;
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  let disposed = false;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let statusController: AbortController | undefined;
  let rewriteController: AbortController | undefined;

  const meta = () => app.state.workspace.meta?.pr || null;
  const sync = () => ({
    running: !!editor.git.state.pending,
    inProgress: editor.git.state.sync.inProgress || '',
    rewritten: !!editor.git.state.sync.rewritten,
  });
  const mergeState = () => state.info?.status?.state || '';
  const base = () => state.info?.base || meta()?.base || 'the base branch';
  const allowed = () => state.info?.status?.methods || [];
  const method = () => chosenMethod(allowed(), state.remembered);
  const pill = () => mergePill(sync(), state.info?.status, base());
  const gate = () => reviewGate(sync(), mergeState(), base());
  const canMerge = () =>
    !!state.info?.canMerge &&
    allowed().length > 0 &&
    mergeState() !== 'merged' &&
    mergeState() !== 'closed';
  const warnings = () => (state.info ? mergeWarnings(state.info, sync(), base()) : null);
  const commitCount = () => state.info?.commits?.length || 0;

  async function refreshMergeStatus() {
    if (!meta()) return;
    clearTimeout(retryTimer);
    statusController?.abort();
    const controller = new AbortController();
    statusController = controller;
    set({ pending: true, checkedAt: Date.now() });
    let info = null;
    try {
      info = decodeMerge(
        await request('api/pr/merge-status', undefined, { signal: controller.signal }),
      );
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      // No pill beats a wrong one.
      set('error', errorMessage(error));
    }
    if (disposed || controller.signal.aborted) return;
    batch(() => {
      set('info', reconcile(info));
      set('pending', false);
      if (info) set('error', '');
    });
    if (info?.status?.state === 'unknown' && retries < UNKNOWN_RETRIES) {
      retries++;
      retryTimer = setTimeout(() => void refreshMergeStatus(), UNKNOWN_DELAY);
    } else retries = 0;
  }

  function rememberMethod(value: string): void {
    set('remembered', value);
    try {
      localStorage.setItem(METHOD_KEY, value);
    } catch {
      // Private browsing may refuse storage; the choice still holds for this page.
    }
  }

  async function openMergeDialog(requested?: string): Promise<void> {
    // Re-read right before showing it: what the dialog says is what merges.
    await refreshMergeStatus();
    if (disposed || !canMerge()) return;
    const value = requested && allowed().includes(requested) ? requested : method();
    const drafts: Record<string, MergeMessage> = {};
    for (const [key, draft] of Object.entries(state.info?.defaults || {}))
      drafts[key] = { ...draft };
    set('dialog', {
      open: true,
      method: value,
      drafts,
      instruction: '',
      rewrite: false,
      pending: false,
      error: '',
    });
  }

  function defaultDraft(value: string): MergeMessage {
    return { ...(state.info?.defaults?.[value] || { title: '', message: '' }) };
  }

  async function rewriteMergeMessage() {
    const dialog = state.dialog;
    if (dialog.rewriting.pending || dialog.method === 'rebase') return;
    const target = dialog.method;
    const draft = dialog.drafts[target] || { title: '', message: '' };
    rewriteController?.abort();
    const controller = new AbortController();
    rewriteController = controller;
    set('dialog', { rewrite: true, error: '', rewriting: { pending: true, seconds: 0 } });
    try {
      const job = await editor.actions.runAgentJob(
        'api/pr/merge-message',
        { method: target, instruction: dialog.instruction.trim(), ...draft },
        {
          signal: controller.signal,
          progress: (update) =>
            set('dialog', 'rewriting', 'seconds', Math.round((update.ms || 0) / 1000)),
        },
      );
      if (disposed) return;
      const message = splitMessage(job.stdout || job.log || '');
      if (!message.title) throw new Error('The harness returned an empty message.');
      set('dialog', 'drafts', target, message);
    } catch (error) {
      if (disposed || isAbort(error)) return;
      const body = error instanceof Error && 'body' in error ? error.body : null;
      const harness = isRecord(body) && typeof body.harness === 'string' ? body.harness : '';
      set('dialog', {
        rewrite: false,
        error: harness ? `${harness}: ${errorMessage(error)}` : errorMessage(error),
      });
    } finally {
      if (!disposed && rewriteController === controller)
        set('dialog', 'rewriting', { pending: false, seconds: 0 });
    }
  }

  async function confirmMerge() {
    const dialog = state.dialog;
    if (!dialog.open || dialog.pending || dialog.rewriting.pending || warnings()?.block) return;
    const draft = dialog.drafts[dialog.method] || { title: '', message: '' };
    if (dialog.method !== 'rebase' && !draft.title?.trim()) {
      set('dialog', 'error', 'The commit needs a title.');
      return;
    }
    set('dialog', { pending: true, error: '' });
    try {
      await post('api/pr/merge', {
        method: dialog.method,
        title: draft.title || '',
        message: draft.message || '',
      });
    } catch (error) {
      if (disposed) return;
      set('dialog', { pending: false, error: errorMessage(error) || 'Merge failed' });
      void refreshMergeStatus();
      return;
    }
    if (disposed) return;
    const done = MERGE_METHODS[dialog.method]?.done || 'Merged';
    set('dialog', { open: false, pending: false });
    toast('success', `${done} into ${base()}`);
    // Re-reads the PR, and with it this status.
    await editor.actions.refreshPRMeta();
  }

  onCleanup(() => {
    disposed = true;
    clearTimeout(retryTimer);
    statusController?.abort();
    rewriteController?.abort();
  });

  return {
    state,
    sync,
    base,
    allowed,
    method,
    pill,
    gate,
    canMerge,
    warnings,
    commitCount,
    actions: {
      refreshMergeStatus,
      openMergeDialog,
      closeMergeDialog() {
        rewriteController?.abort();
        set('dialog', { open: false, rewriting: { pending: false, seconds: 0 } });
      },
      // Picking a method is picking what to do: open the dialog for it when merging is possible.
      chooseMergeMethod(value: string): void {
        rememberMethod(value);
        if (canMerge() && !sync().running) void openMergeDialog(value);
      },
      setMergeMethod(value: string): void {
        rememberMethod(value);
        set('dialog', 'method', value);
      },
      setMergeField: (field: 'title' | 'message', value: string) =>
        set('dialog', 'drafts', state.dialog.method, (draft) => ({
          ...(draft || defaultDraft(state.dialog.method)),
          [field]: value,
        })),
      resetMergeMessage() {
        rewriteController?.abort();
        set('dialog', { rewrite: false, error: '' });
        set('dialog', 'drafts', state.dialog.method, defaultDraft(state.dialog.method));
      },
      setMergeRewrite(enabled: boolean): void {
        if (enabled) void rewriteMergeMessage();
        else {
          rewriteController?.abort();
          set('dialog', { rewrite: false });
          set('dialog', 'drafts', state.dialog.method, defaultDraft(state.dialog.method));
        }
      },
      setMergeInstruction: (value: string) => set('dialog', 'instruction', value),
      rewriteMergeMessage,
      confirmMerge,
      runMergeFix() {
        const act = pill()?.act;
        if (act === 'resolve') void editor.actions.resolvePRBase();
        else if (act === 'push') editor.actions.confirmForcePush();
      },
      // Mergeability changes elsewhere (checks finish, someone pushes): re-read at most every 20s.
      refreshStaleMergeStatus() {
        if (meta() && Date.now() - state.checkedAt > 20000) void refreshMergeStatus();
      },
    },
  };
}
