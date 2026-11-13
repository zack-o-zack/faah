import { canDiff, previewKind, viewMode } from './view.js';
import { diffLayout } from '../settings/logic.ts';
import { zoomScale } from './image-math.js';
import { orbStart, orbFromThread, orbFromStep, orbFromSummary } from './orb-model.js';

export function createViewerActions(store) {
  const patch = (document, value) => {
    if (store.state.documents.tabs.includes(document))
      store.actions.patchDocument(document.path, value);
  };
  function setView(document, view) {
    if (!document || document.isEditing) return;
    patch(document, { view, diffMode: null, diffDismissed: true });
  }
  function setDiffMode(document, mode) {
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
  function updateImage(document, update) {
    patch(document, { image: { ...document.image, ...update } });
  }
  const model = () => store.state.explanation.model;
  const setOrb = (value) => store.actions.setExplanation(value);
  return {
    setView,
    setDiffMode,
    togglePreview(document, line = 1) {
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
    invalidate(document) {
      if (document) patch(document, { viewerRevision: (document.viewerRevision || 0) + 1 });
    },
    rememberPreview(document, scrollTop) {
      patch(document, { mdScroll: scrollTop, mdLine: 0, mdAnchor: '' });
    },
    rememberDiff(document, scrollTop) {
      patch(document, { diffScroll: scrollTop });
    },
    requestPreviewLine(document, line) {
      patch(document, { mdLine: line });
    },
    requestAnchor(document, anchor) {
      patch(document, { mdAnchor: anchor });
    },
    clearPreviewTarget(document) {
      patch(document, { mdLine: 0, mdAnchor: '' });
    },
    toggleSection(document, kind, collapsed = document[kind + 'Collapsed']) {
      patch(document, { [kind + 'Collapsed']: !collapsed });
    },
    focusScope(document, scope) {
      patch(document, { diffScope: scope, prCollapsed: undefined, youCollapsed: undefined });
    },
    updateImage,
    imageLoaded(document, width, height) {
      patch(document, { imageMeta: { width, height } });
      if (document.image.pixelated === null)
        updateImage(document, { pixelated: width <= 64 && height <= 64 });
    },
    zoomImage(document, direction, fitted, factor) {
      updateImage(document, {
        fit: false,
        scale: zoomScale(document.image.fit ? fitted : document.image.scale, direction, factor),
      });
    },
    fitImage(document) {
      updateImage(document, { fit: true, panX: 0, panY: 0 });
    },
    actualImage(document) {
      updateImage(document, { fit: false, scale: 1, panX: 0, panY: 0 });
    },
    cycleImageBg(document) {
      const modes = ['checker', 'dark', 'light'];
      updateImage(document, { bg: modes[(modes.indexOf(document.image.bg) + 1) % modes.length] });
    },
    togglePixelated(document) {
      updateImage(document, { pixelated: !document.image.pixelated });
    },
    toggleViewed(path) {
      store.actions.setViewed(path, !store.state.viewers.viewed[path]);
    },
    orbBegin() {
      setOrb(orbStart());
    },
    orbAttach(thread) {
      if (model() && !model().id) setOrb(orbFromThread(model(), thread));
    },
    orbFailed(message) {
      if (model() && !model().id) setOrb({ ...model(), phase: 'failed', error: message });
    },
    orbThread(thread) {
      if (model()?.id === thread.id) setOrb(orbFromThread(model(), thread));
    },
    orbStep(id, text) {
      if (model()?.id === id) setOrb(orbFromStep(model(), text));
    },
    orbSummary(summary) {
      if (model()?.id === summary.id) setOrb(orbFromSummary(model(), summary));
    },
    dismissOrb() {
      setOrb(null);
    },
    showOrbThread(shown) {
      store.actions.setExplanationShown(shown);
      if (shown && model()?.phase !== 'running') setOrb(null);
    },
  };
}
