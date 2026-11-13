import type { Request } from '../lib/api.ts';
import type { DocTab } from '../editor/types.ts';
import type { GitSnapshot } from '../workspace/decode.ts';
import type { EditorHost } from '../editor/contracts.ts';
import { decodeGutter, decodeCommitFiles } from './decode.ts';
import { isAbort, errorMessage } from '../lib/decode.ts';
interface DocumentGitHost extends Omit<EditorHost, 'actions'> {
  actions: EditorHost['actions'] & {
    reloadOpenTabs: (options: { onlyIfChanged: boolean }) => Promise<void>;
    reconcileTreeSnapshot: () => Promise<void>;
    closeTabs: (indices: number[]) => void;
    setDiffMode: (doc: DocTab, mode: string) => void;
    stepDiffFile: (doc: DocTab, file: { path: string }) => Promise<void>;
  };
}
import { diffLayout } from '../settings/logic.ts';
import { onCleanup } from 'solid-js';
import { api } from '../lib/api.ts';
import { documentGitPlan } from './document-logic.ts';
import { canDiff } from '../viewers/view.ts';
export function createDocumentGitActions(
  editor: DocumentGitHost,
  options: { request?: Request } = {},
): ReturnType<typeof buildDocumentGitActions> {
  return buildDocumentGitActions(editor, options);
}
function buildDocumentGitActions(editor: DocumentGitHost, options: { request?: Request } = {}) {
  const app = editor.store;
  const request = options.request || api;
  const pending = new Map<string, AbortController>();
  let disposed = false,
    queued: GitSnapshot | null = null,
    running = false,
    signature = '';
  async function loadGutter(path: string): Promise<void> {
    const document = app.state.documents.tabs.find((tab) => tab.path === path);
    if (!document || !app.state.workspace.meta?.git) return;
    const buffer = app.buffers.get(path),
      ref = document.diffRef || '';
    pending.get(path)?.abort();
    const controller = new AbortController();
    pending.set(path, controller);
    try {
      const result = decodeGutter(
        await request('api/gutter', { path, ref }, { signal: controller.signal }),
      );
      if (
        disposed ||
        controller.signal.aborted ||
        app.buffers.get(path) !== buffer ||
        (document.diffRef || '') !== ref
      )
        return;
      const marks = new Map<number, string>();
      for (const line of result.modified || []) marks.set(line, 'mod');
      for (const line of result.added || []) marks.set(line, 'add');
      const available = !!(result.available || document.diffBase);
      const patch: Partial<DocTab> = {
        gutterLoaded: true,
        diffAvailable: available,
        gutter: result.available ? { marks, dels: new Set(result.deleted || []) } : null,
      };
      if (available && !document.diffMode && !document.diffDismissed && document.openedInDiffView)
        patch.diffMode = diffLayout(app.settings.preferences());
      app.actions.patchDocument(path, patch);
    } catch (error) {
      if (!isAbort(error) && !disposed) app.actions.setWorkspaceError(errorMessage(error));
    } finally {
      if (pending.get(path) === controller) pending.delete(path);
    }
  }
  async function apply(snapshot: GitSnapshot): Promise<void> {
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
  async function receive(snapshot: GitSnapshot): Promise<void> {
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
      if (!disposed && !isAbort(error)) app.actions.setWorkspaceError(errorMessage(error));
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

  function toggleActiveDiff() {
    const document = editor.active();
    if (!document || !canDiff(document, app.state.workspace.meta)) return;
    editor.actions.setDiffMode(
      document,
      document.diffMode ? 'source' : diffLayout(app.settings.preferences()),
    );
  }

  async function stepChangedFile(direction: number): Promise<void> {
    const document = editor.active();
    if (!document) return;
    let files = document.turnFiles;
    if (!files && document.diffRef)
      files = decodeCommitFiles(await request('api/commitfiles', { sha: document.diffRef })).files;
    files ||= (app.state.workspace.meta?.gitFiles || []).map((path) => ({ path }));
    const navigable = files
      .map((file) => (typeof file === 'string' ? { path: file } : file))
      .filter((file) => !file.binary);
    const next = navigable[navigable.findIndex((file) => file.path === document.path) + direction];
    if (next) await editor.actions.stepDiffFile(document, next);
  }
  return {
    loadGutter,
    toggleActiveDiff,
    stepChangedFile,
    stepDiffHunk: (direction: number) => editor.services.diff?.stepHunk(direction),
  };
}
