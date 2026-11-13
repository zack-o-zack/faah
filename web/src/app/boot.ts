import { api } from '../lib/api.ts';
import { toast } from '../lib/toast.tsx';
import type { WorkspaceMeta } from './types.ts';

interface BootDocument {
  path: string;
  diffAvailable?: boolean;
}

/** What starting the workspace reaches in the editor store. */
export interface BootEditor {
  active: () => BootDocument | null;
  store: {
    state: {
      workspace: { meta: WorkspaceMeta | null };
      documents: { tabs: BootDocument[] };
    };
    actions: { setWorkspace: (meta: unknown) => void; setWorkspaceError: (error: string) => void };
  };
  tree: { hasGitView: () => boolean; mode: () => 'git' | 'files' };
  actions: {
    loadSettings: () => Promise<void>;
    initializeThreads: () => Promise<void>;
    initializeGit: () => Promise<void>;
    acceptAgentMeta: (meta: WorkspaceMeta) => void;
    initializePR: () => void;
    initializeAgents: () => Promise<void>;
    setAutoRevealSuppressed: (suppressed: boolean) => void;
    refreshTree: () => Promise<void>;
    refreshWorkspace: () => Promise<void>;
    startWorkspaceStream: () => void;
    refreshUnpushed: () => Promise<void>;
    setTreeMode: (mode: 'git' | 'files', options: { expandDirty: boolean }) => Promise<void>;
    expandTree: (dirtyOnly: boolean) => Promise<void>;
    collapseTree: () => void;
    revealFile: (path: string) => Promise<void>;
    switchTab: (index: number) => void;
    openFile: (path: string, options?: { line?: number }) => Promise<void>;
    setReviewMode: (mode: 'review' | 'code') => void;
  };
}

/** How often to ask whether the background indexer has finished. */
const READY_POLL_MS = 150;

/** A `?path=&line=` link opens that file; the parameters are then dropped from the address. */
function takeInitialLocation(): { path: string; line?: number } | null {
  const url = new URL(window.location.href);
  const path = url.searchParams.get('path');
  if (!path) return null;
  const line = Number.parseInt(url.searchParams.get('line') || '', 10) || undefined;
  url.searchParams.delete('path');
  url.searchParams.delete('line');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  return { path, line };
}

/**
 * Loads the workspace and opens it the way it was left: Git view with the first change selected
 * when there are changes, the file tree otherwise, and the pull request overview for a PR session.
 * Returns a function that stops the readiness poll.
 */
export function bootWorkspace(editor: BootEditor): () => void {
  const { actions } = editor;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const meta = (): WorkspaceMeta | null => editor.store.state.workspace.meta;

  // The unpushed list decides this too: a clean tree with local commits still belongs in Git
  // view, which is the only place they are listed.
  async function applyGitSidebarState(gitReady: Promise<void>): Promise<boolean> {
    await gitReady;
    const showGit = editor.tree.hasGitView();
    await actions.setTreeMode(showGit ? 'git' : 'files', { expandDirty: showGit });
    return !!(meta()?.git && ((meta()?.gitChanges || 0) > 0 || meta()?.pr));
  }
  async function selectChangedFile(): Promise<void> {
    if (editor.active()?.diffAvailable) return;
    const index = editor.store.state.documents.tabs.findIndex((tab) => tab.diffAvailable);
    const first = meta()?.gitFiles?.[0];
    if (index >= 0) actions.switchTab(index);
    else if (first) await actions.openFile(first);
  }
  async function revealActive(): Promise<void> {
    if (editor.tree.mode() !== 'git') return actions.collapseTree();
    await actions.expandTree(true);
    const path = editor.active()?.path;
    if (path) await actions.revealFile(path);
  }
  // gitChanges and gitFiles stay zero until the indexer finishes, so a session that loads before
  // then (common right after `faah <pr-url>`) selects its first change once it does.
  async function whenReady(follow: boolean): Promise<boolean> {
    const next: unknown = await api('api/meta');
    if (disposed) return true;
    if (!(next && typeof next === 'object' && 'ready' in next && next.ready)) return false;
    editor.store.actions.setWorkspace(next);
    const gitReady = actions.initializeGit();
    actions.setAutoRevealSuppressed(true);
    await actions.refreshTree();
    await actions.refreshWorkspace();
    if (follow) {
      if (await applyGitSidebarState(gitReady)) await selectChangedFile();
      await revealActive();
    }
    actions.setAutoRevealSuppressed(false);
    return true;
  }
  // One request at a time; a failed request ends the poll.
  function pollUntilReady(follow: boolean): void {
    timer = setTimeout(() => {
      whenReady(follow).then(
        (ready) => ready || pollUntilReady(follow),
        () => {},
      );
    }, READY_POLL_MS);
  }

  async function start(): Promise<void> {
    void actions.loadSettings();
    editor.store.actions.setWorkspace(await api('api/meta'));
    if (disposed) return;
    void actions.initializeThreads();
    const gitReady = actions.initializeGit();
    const loaded = meta();
    if (loaded) actions.acceptAgentMeta(loaded);
    actions.initializePR();
    actions.setAutoRevealSuppressed(true);
    await actions.refreshTree();
    actions.startWorkspaceStream();
    const hasChanges = await applyGitSidebarState(gitReady);
    const initial = takeInitialLocation();
    if (initial) await actions.openFile(initial.path, { line: initial.line });
    else if (hasChanges) await selectChangedFile();
    await revealActive();
    actions.setAutoRevealSuppressed(false);
    // A PR session opens on the pull request itself.
    if (meta()?.pr) actions.setReviewMode('review');
    if (!meta()?.ready) pollUntilReady(!initial);
    void actions.initializeAgents();
  }

  start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    editor.store.actions.setWorkspaceError(message);
    toast('error', message);
  });
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}
