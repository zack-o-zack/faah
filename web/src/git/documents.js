import { onCleanup } from 'solid-js';
import { api } from '../lib/api.js';
import { documentGitPlan } from './document-logic.js';
export function createDocumentGitActions(editor, options = {}) {
  const app = editor.store;
  const request = options.request || api;
  const pending = new Map();
  let disposed = false,
    queued = null,
    running = false,
    signature = '';
  async function loadGutter(path) {
    const document = app.state.documents.tabs.find((tab) => tab.path === path);
    if (!document || !app.state.workspace.meta?.git) return;
    const buffer = app.buffers.get(path),
      ref = document.diffRef || '';
    pending.get(path)?.abort();
    const controller = new AbortController();
    pending.set(path, controller);
    try {
      const result = await request('api/gutter', { path, ref }, { signal: controller.signal });
      if (
        disposed ||
        controller.signal.aborted ||
        app.buffers.get(path) !== buffer ||
        (document.diffRef || '') !== ref
      )
        return;
      const marks = new Map();
      for (const line of result.modified || []) marks.set(line, 'mod');
      for (const line of result.added || []) marks.set(line, 'add');
      const available = !!(result.available || document.diffBase);
      const patch = {
        gutterLoaded: true,
        diffAvailable: available,
        gutter: result.available ? { marks, dels: new Set(result.deleted || []) } : null,
      };
      if (available && !document.diffMode && !document.diffDismissed && document.openedInDiffView)
        patch.diffMode = localStorage.getItem('faah.diffLayout') || 'split';
      app.actions.patchDocument(path, patch);
    } catch (error) {
      if (error.name !== 'AbortError' && !disposed) app.actions.setWorkspaceError(error.message);
    } finally {
      if (pending.get(path) === controller) pending.delete(path);
    }
  }
  async function apply(snapshot) {
    const next = JSON.stringify(snapshot);
    if (next === signature) {
      await editor.actions.reloadOpenTabs({ onlyIfChanged: true });
      return;
    }
    signature = next;
    await editor.actions.reconcileTreeSnapshot();
    if (disposed) return;
    const plan = documentGitPlan(
      app.state.documents.tabs,
      snapshot,
      !!app.state.workspace.meta?.pr,
    );
    if (plan.close.length) editor.actions.closeTabs(plan.close);
    for (const patch of plan.patch)
      app.actions.patchDocument(patch.path, { diffAvailable: patch.diffAvailable });
    if (plan.reload) await editor.actions.reloadOpenTabs({ onlyIfChanged: true });
    const document = editor.active();
    if (document && !document.diffRef && snapshot.statuses?.[document.path])
      await loadGutter(document.path);
  }
  async function receive(snapshot) {
    queued = snapshot;
    if (running) return;
    running = true;
    try {
      while (queued && !disposed) {
        const next = queued;
        queued = null;
        await apply(next);
      }
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') app.actions.setWorkspaceError(error.message);
    } finally {
      running = false;
    }
  }
  const release = app.actions.observeGitSnapshots((snapshot) => void receive(snapshot));
  onCleanup(() => {
    disposed = true;
    queued = null;
    release();
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  });
  return { loadGutter };
}
