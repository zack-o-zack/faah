import type { AppState } from '../app/store.ts';
import type { DocTab, ImageState } from '../editor/types.ts';
import type { SettingsStore } from '../settings/store.ts';
import type { OrbModel, OrbThread } from './orb-model.ts';
interface ViewerStore {
  state: AppState;
  settings: SettingsStore;
  actions: {
    patchDocument: (path: string, patch: Partial<DocTab>) => void;
    setExplanation: (value: OrbModel | null) => void;
    setExplanationShown: (shown: boolean) => void;
    setViewed: (path: string, viewed: boolean) => void;
  };
}
import { canDiff, previewKind, viewMode } from './view.ts';
import { diffLayout } from '../settings/logic.ts';
import { zoomScale } from './image-math.ts';
import { orbStart, orbFromThread, orbFromStep, orbFromSummary } from './orb-model.ts';

export function createViewerActions(store: ViewerStore) {
  const patch = (document: DocTab, value: Partial<DocTab>): void => {
    if (store.state.documents.tabs.includes(document))
      store.actions.patchDocument(document.path, value);
  };
  function setView(document: DocTab | null, view: string): void {
    if (!document || document.isEditing) return;
    patch(document, { view, diffMode: null, diffDismissed: true });
  }
  function setDiffMode(document: DocTab | null, mode: string): void {
    if (!document || (mode !== 'source' && !canDiff(document, store.state.workspace.meta))) return;
    patch(document, {
      diffMode: mode === 'source' ? null : mode,
      diffDismissed: mode === 'source',
      openedInDiffView: mode !== 'source',
    });
    // The last layout chosen is the default for the next diff.
    if (mode !== 'source' && mode !== diffLayout(store.settings.preferences()))
      void store.settings.actions.setSetting('diffEditor.renderSideBySide', mode === 'split');
  }
  function updateImage(document: DocTab, update: Partial<ImageState>): void {
    patch(document, { image: { ...document.image, ...update } });
  }
  const model = () => store.state.explanation.model;
  const setOrb = (value: OrbModel | null): void => store.actions.setExplanation(value);
  return {
    setView,
    setDiffMode,
    togglePreview(document: DocTab | null, line = 1): void {
      if (!document) return;
      const kind = previewKind(document);
      if (!kind || document.isEditing) return;
      const view = viewMode(document) === kind ? 'source' : kind;
      patch(document, { mdLine: line });
      setView(document, view);
      // Whether the next file of this kind opens previewed.
      void store.settings.actions.setSetting(
        kind === 'table' ? 'table.preview.open' : 'markdown.preview.open',
        view !== 'source',
      );
    },
    invalidate(document: DocTab | null): void {
      if (document) patch(document, { viewerRevision: (document.viewerRevision || 0) + 1 });
    },
    rememberPreview(document: DocTab, scrollTop: number): void {
      patch(document, { mdScroll: scrollTop, mdLine: 0, mdAnchor: '' });
    },
    rememberDiff(document: DocTab, scrollTop: number): void {
      patch(document, { diffScroll: scrollTop });
    },
    requestPreviewLine(document: DocTab | null, line: number): void {
      if (!document) return;
      patch(document, { mdLine: line });
    },
    requestAnchor(document: DocTab, anchor: string): void {
      patch(document, { mdAnchor: anchor });
    },
    clearPreviewTarget(document: DocTab): void {
      patch(document, { mdLine: 0, mdAnchor: '' });
    },
    toggleSection(
      document: DocTab,
      kind: 'pr' | 'you',
      collapsed = kind === 'pr' ? document.prCollapsed : document.youCollapsed,
    ): void {
      patch(document, { [kind + 'Collapsed']: !collapsed });
    },
    focusScope(document: DocTab, scope: string): void {
      patch(document, { diffScope: scope, prCollapsed: undefined, youCollapsed: undefined });
    },
    updateImage,
    imageLoaded(document: DocTab, width: number, height: number): void {
      patch(document, { imageMeta: { width, height } });
      if (document.image.pixelated === null)
        updateImage(document, { pixelated: width <= 64 && height <= 64 });
    },
    zoomImage(document: DocTab, direction: number, fitted: number, factor?: number): void {
      updateImage(document, {
        fit: false,
        scale: zoomScale(document.image.fit ? fitted : document.image.scale, direction, factor),
      });
    },
    fitImage(document: DocTab): void {
      updateImage(document, { fit: true, panX: 0, panY: 0 });
    },
    actualImage(document: DocTab): void {
      updateImage(document, { fit: false, scale: 1, panX: 0, panY: 0 });
    },
    cycleImageBg(document: DocTab): void {
      const modes = ['checker', 'dark', 'light'];
      updateImage(document, {
        bg: modes[(modes.indexOf(document.image.bg) + 1) % modes.length] || 'checker',
      });
    },
    togglePixelated(document: DocTab): void {
      updateImage(document, { pixelated: !document.image.pixelated });
    },
    toggleViewed(path: string): void {
      store.actions.setViewed(path, !store.state.viewers.viewed[path]);
    },
    orbBegin() {
      setOrb(orbStart());
    },
    orbAttach(thread: OrbThread): void {
      const current = model();
      if (current && !current.id) setOrb(orbFromThread(current, thread));
    },
    orbFailed(message: string): void {
      const current = model();
      if (current && !current.id) setOrb({ ...current, phase: 'failed', error: message });
    },
    orbThread(thread: OrbThread): void {
      const current = model();
      if (current?.id === thread.id) setOrb(orbFromThread(current, thread));
    },
    orbStep(id: string, text: string): void {
      const current = model();
      if (current?.id === id) setOrb(orbFromStep(current, text));
    },
    orbSummary(summary: { id: string; running?: boolean; failed?: boolean }): void {
      const current = model();
      if (current?.id === summary.id)
        setOrb(orbFromSummary(current, { ...summary, running: !!summary.running }));
    },
    dismissOrb() {
      setOrb(null);
    },
    showOrbThread(shown: boolean): void {
      store.actions.setExplanationShown(shown);
      if (shown && model()?.phase !== 'running') setOrb(null);
    },
  };
}
