import { batch, createMemo, onCleanup } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.js';
import { toast } from '../lib/toast.jsx';
import {
  applicableDrafts,
  commentThreads,
  composerTarget,
  markerCounts,
  threadKey,
} from './logic.js';

const VERDICTS = {
  APPROVE: 'Review approved',
  REQUEST_CHANGES: 'Changes requested',
  COMMENT: 'Review comment submitted',
};

/**
 * @typedef {Object} PRState
 * @property {object[]} drafts
 * @property {object[]} issueComments
 * @property {object[]} reviewComments
 * @property {{comments:boolean,existing:boolean,meta:boolean}} loading
 * @property {string} loadError
 * @property {{open:boolean,body:string,pending:string,error:string}} review
 * @property {object[]} composers
 * @property {string} focus
 * @property {{body:string,pending:boolean,error:string}} issue
 * @property {Object<string, {body:string,pending:boolean,error:string}>} replies
 * @property {Object<string, boolean>} deleting
 * @property {Object<string, boolean>} expanded
 * @property {{collapsed:boolean,height:number}} panel
 * @property {{key:string,sequence:number}} reveal
 * @property {{pending:boolean,seconds:number,error:string}} batch
 */
/** @returns {PRState} */
function initialState() {
  return {
    drafts: [],
    issueComments: [],
    reviewComments: [],
    loading: { comments: false, existing: false, meta: false },
    loadError: '',
    review: { open: false, body: '', pending: '', error: '' },
    composers: [],
    focus: '',
    issue: { body: '', pending: false, error: '' },
    replies: {},
    deleting: {},
    expanded: {},
    panel: { collapsed: true, height: 288 },
    reveal: { key: '', sequence: 0 },
    batch: { pending: false, seconds: 0, error: '' },
  };
}

export function createPRStore(editor, options = {}) {
  const app = editor.store;
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  const controllers = new Set();
  let disposed = false;
  let composerId = 0;

  const meta = () => app.state.workspace.meta?.pr || null;
  const available = () => !!meta();
  const threads = createMemo(() => commentThreads(state.reviewComments, state.drafts));
  const markers = createMemo(() => markerCounts(state.reviewComments, state.drafts));
  const applicable = createMemo(() => applicableDrafts(state.drafts));
  const commentCount = () =>
    state.issueComments.length + state.reviewComments.length + state.drafts.length;

  async function owned(call) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await call(controller.signal);
    } finally {
      controllers.delete(controller);
    }
  }
  const get = (path, params) => owned((signal) => request(path, params, { signal }));
  const send = (path, body) => owned((signal) => post(path, body, { signal }));
  const live = (error) => !disposed && error?.name !== 'AbortError';

  /** Writes need a token; without one the Connect dialog explains why. */
  function needsToken(reason) {
    if (!meta()?.readOnly) return false;
    editor.actions.openForgeConnect(reason);
    return true;
  }

  async function refreshComments() {
    set('loading', 'comments', true);
    try {
      const reply = await get('api/pr/comments');
      if (!disposed) set('drafts', reconcile(reply.comments || [], { key: 'id' }));
    } catch (error) {
      // A read-only session has no drafts; the bar still shows PR metadata.
      if (live(error)) set('loadError', error.message);
    } finally {
      if (!disposed) set('loading', 'comments', false);
    }
  }

  // Posted comments are fetched live so another reviewer's activity shows on refresh.
  async function refreshExistingComments() {
    set('loading', 'existing', true);
    try {
      const reply = await get('api/pr/existing-comments');
      if (disposed) return;
      batch(() => {
        set('issueComments', reconcile(reply.issueComments || [], { key: 'id' }));
        set('reviewComments', reconcile(reply.reviewComments || [], { key: 'id' }));
        set('loadError', '');
      });
    } catch (error) {
      if (live(error)) set('loadError', error.message);
    } finally {
      if (!disposed) set('loading', 'existing', false);
    }
  }

  async function refreshPRMeta() {
    if (!meta()) return;
    set('loading', 'meta', true);
    try {
      const reply = await get('api/pr/meta');
      if (disposed) return;
      const filesChanged = JSON.stringify(meta().files || []) !== JSON.stringify(reply.files || []);
      app.actions.patchWorkspace('pr', { ...meta(), ...reply });
      // Tree rows carry a PR-file flag from this set.
      if (filesChanged) await editor.actions.refreshTree();
    } catch (error) {
      if (live(error)) set('loadError', error.message);
    } finally {
      if (!disposed) set('loading', 'meta', false);
    }
    await Promise.all([refreshExistingComments(), refreshComments()]);
    await editor.actions.refreshMergeStatus();
  }

  function initializePR() {
    if (!meta()) return;
    void refreshComments();
    void refreshExistingComments();
    void editor.actions.refreshMergeStatus();
  }

  async function submitReview(event) {
    if (state.review.pending || needsToken('to submit a review')) return;
    const body = state.review.body.trim();
    if (event === 'REQUEST_CHANGES' && !body && !state.drafts.length) {
      set('review', 'error', 'Add a comment or review body before requesting changes');
      return;
    }
    set('review', { pending: event, error: '' });
    try {
      await send('api/pr/submit', { event, body });
      if (disposed) return;
      batch(() => {
        set('drafts', []);
        set('composers', []);
        set('review', { open: false, body: '' });
      });
      toast('success', VERDICTS[event]);
      // An approval can be what branch protection was waiting for.
      void editor.actions.refreshMergeStatus();
    } catch (error) {
      if (live(error)) set('review', 'error', error.message || 'Could not submit review');
    } finally {
      if (!disposed) set('review', 'pending', '');
    }
  }

  function openPRComposer(info) {
    if (!meta() || !info?.path) return;
    const target = composerTarget(info);
    const id = 'prc' + ++composerId;
    batch(() => {
      set('composers', state.composers.length, {
        id,
        ...target,
        body: '',
        pending: false,
        error: '',
      });
      set('focus', id);
    });
    editor.actions.setSelection(null);
  }
  const composerIndex = (id) => state.composers.findIndex((composer) => composer.id === id);
  function closeComposer(id) {
    set('composers', (list) => list.filter((composer) => composer.id !== id));
  }
  async function sendComposer(id) {
    const index = composerIndex(id);
    const composer = state.composers[index];
    if (!composer || composer.pending || !composer.body.trim()) return;
    set('composers', index, { pending: true, error: '' });
    try {
      const draft = await send('api/pr/comments', {
        path: composer.path,
        line: composer.line,
        side: composer.side,
        body: composer.body.trim(),
      });
      if (disposed) return;
      batch(() => {
        set('drafts', state.drafts.length, draft);
        set('expanded', threadKey(composer.path, composer.side, composer.line), true);
        closeComposer(id);
      });
    } catch (error) {
      const current = composerIndex(id);
      if (live(error) && current >= 0)
        set('composers', current, {
          pending: false,
          error: error.message || 'Could not add comment',
        });
    }
  }
  async function revealComposer(id) {
    const composer = state.composers[composerIndex(id)];
    if (!composer) return;
    if (editor.active()?.path === composer.path && editor.active()?.diffMode)
      editor.actions.centerLine(composer.line);
    else await editor.actions.openFile(composer.path, { line: composer.line, view: 'diff' });
  }

  async function deleteDraft(id) {
    if (state.deleting[id]) return;
    set('deleting', id, true);
    try {
      await send('api/pr/comments/delete?id=' + id, {});
      if (!disposed) set('drafts', (list) => list.filter((draft) => draft.id !== id));
    } catch (error) {
      if (live(error)) toast('error', error.message || 'Could not delete draft');
    } finally {
      if (!disposed)
        set(
          produce((draft) => {
            delete draft.deleting[id];
          }),
        );
    }
  }

  async function sendIssueComment() {
    if (needsToken('to post comments')) return;
    const body = state.issue.body.trim();
    if (!body || state.issue.pending) return;
    set('issue', { pending: true, error: '' });
    try {
      const comment = await send('api/pr/comments/issue', { body });
      if (disposed) return;
      batch(() => {
        set('issueComments', state.issueComments.length, comment);
        set('expanded', 'issue:' + comment.id, true);
        set('issue', 'body', '');
      });
      toast('success', 'Comment posted');
    } catch (error) {
      if (live(error)) set('issue', 'error', error.message || 'Could not post comment');
    } finally {
      if (!disposed) set('issue', 'pending', false);
    }
  }

  async function sendReply(rootId) {
    if (needsToken('to reply to comments')) return;
    const reply = state.replies[rootId];
    const body = reply?.body.trim();
    if (!body || reply.pending) return;
    set('replies', rootId, { pending: true, error: '' });
    try {
      const comment = await send('api/pr/comments/review-reply', { commentId: rootId, body });
      if (disposed) return;
      batch(() => {
        set('reviewComments', state.reviewComments.length, comment);
        set('replies', rootId, 'body', '');
      });
      toast('success', 'Reply posted');
    } catch (error) {
      if (live(error)) set('replies', rootId, 'error', error.message || 'Could not reply');
    } finally {
      if (!disposed) set('replies', rootId, 'pending', false);
    }
  }

  async function applyDrafts() {
    const drafts = applicable();
    if (!drafts.length || state.batch.pending) return;
    const edits = drafts.map((draft) => ({
      path: draft.path,
      l1: draft.line,
      l2: draft.line,
      instruction: draft.body.trim(),
    }));
    set('batch', { pending: true, seconds: 0, error: '' });
    try {
      const job = await owned((signal) =>
        editor.actions.runAgentJob(
          'api/agent/batch',
          { edits },
          {
            signal,
            progress: (update) => set('batch', 'seconds', Math.round((update.ms || 0) / 1000)),
          },
        ),
      );
      if (disposed) return;
      if (job.error) {
        set('batch', 'error', job.error);
        if (job.changed?.length) await editor.actions.reloadWorkspace(null);
        return;
      }
      toast('success', `Applied ${edits.length} draft comment${edits.length === 1 ? '' : 's'}`);
      await editor.actions.reloadWorkspace(null);
      await refreshComments();
    } catch (error) {
      if (live(error)) set('batch', 'error', error.message || 'Batch failed');
    } finally {
      if (!disposed) set('batch', 'pending', false);
    }
  }

  // A forge that opens in the workbench gets a new workspace tab there.
  async function launchPR(target) {
    const workbench = app.state.workspace.meta?.workbench;
    if (!workbench) {
      try {
        await post('api/pr/launch', { target });
        toast('success', 'Opening PR in a new tab…');
      } catch (error) {
        toast('error', error.message || 'Could not launch PR review');
      }
      return;
    }
    // The tab opens before the request so the browser counts it as the user's action.
    const tab = window.open('about:blank', '_blank');
    try {
      const reply = await fetch(new URL(workbench + 'api/wb/open', location.origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      }).then((response) => response.json());
      if (reply.error) throw new Error(reply.error);
      const href = new URL(reply.href, location.origin).href;
      if (tab) tab.location.href = href;
      else location.href = href;
    } catch (error) {
      tab?.close();
      toast('error', error.message || 'Could not launch PR review');
    }
  }

  onCleanup(() => {
    disposed = true;
    for (const controller of controllers) controller.abort();
  });

  return {
    state,
    meta,
    available,
    threads,
    markers,
    applicable,
    commentCount,
    marker: (path, side, line) => markers().get(threadKey(path, side, line)) || 0,
    composersAt: (path, side, line) =>
      state.composers.filter(
        (composer) => composer.path === path && composer.side === side && composer.line === line,
      ),
    actions: {
      initializePR,
      refreshPRMeta,
      refreshPRComments: refreshComments,
      refreshExistingComments,
      submitReview,
      openPRComposer,
      setComposerBody: (id, body) => set('composers', composerIndex(id), 'body', body),
      sendComposer,
      composerFocused: () => set('focus', ''),
      closeComposer,
      revealComposer,
      deleteDraft,
      setIssueBody: (body) => set('issue', 'body', body),
      sendIssueComment,
      setReplyBody: (rootId, body) => set('replies', rootId, { body, error: '' }),
      sendReply,
      applyDrafts,
      launchPR,
      setReviewPanel: (open) => set('review', { open, error: '' }),
      setReviewBody: (body) => set('review', 'body', body),
      replyToAuthor(author) {
        const prefix = author ? '@' + author + ' ' : '';
        if (!state.issue.body.startsWith(prefix)) set('issue', 'body', prefix + state.issue.body);
        set('panel', 'collapsed', false);
      },
      setThreadExpanded: (key, open) => set('expanded', key, open),
      // The comments panel shows with the overview, so a gutter marker opens it there.
      revealPRThread(key) {
        batch(() => {
          editor.actions.setReviewMode('review');
          set('panel', 'collapsed', false);
          set('expanded', key, true);
          set('reveal', { key, sequence: state.reveal.sequence + 1 });
        });
      },
      togglePRPanel: () => set('panel', 'collapsed', (collapsed) => !collapsed),
      setPRPanelHeight(height) {
        const max = Math.round(window.innerHeight * 0.8);
        set('panel', { collapsed: false, height: Math.max(80, Math.min(max, height)) });
      },
    },
  };
}
