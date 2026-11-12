import { onCleanup } from 'solid-js';
import { apiPostJson, apiText } from '../lib/api.js';
import { toast } from '../lib/toast.jsx';

export function createEditActions(editor) {
  const { active, buffer, store, services, setUI } = editor;
  const { patch, refresh } = editor.actions;
  onCleanup(() => editRequest?.abort());
  let editRequest;
  async function enterEditMode(line) {
    const document = active();
    if (!document || document.isImage || document.deleted || document.diffRef) return;
    if (
      (document.total > 10000 || document.size > 1024 * 1024) &&
      !confirm(`"${document.name}" is large. Load it for editing?`)
    )
      return;
    const model = buffer();
    if (model.editContent == null) {
      setUI({ editLoading: true, editError: '' });
      try {
        editRequest?.abort();
        editRequest = new AbortController();
        const content = await apiText(
          'api/raw',
          { path: document.path },
          { signal: editRequest.signal },
        );
        if (store.buffers.get(document.path) !== model) return;
        model.setEditContent(content);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setUI('editError', error.message);
          toast('error', error.message);
        }
        return;
      } finally {
        setUI('editLoading', false);
      }
    }
    store.actions.patchDocument(document.path, { isEditing: true, diffMode: null });
    if (active()?.path !== document.path) return;
    services.syncViewers?.();
    queueMicrotask(() => centerEditLine(line || document.cur));
  }
  function centerEditLine(line, start, end) {
    services.edit?.center(line, start, end);
  }
  async function exitEditMode(force = false) {
    if (!active()?.isEditing) return;
    if (active().dirty && !force && !confirm('You have unsaved changes. Discard changes?')) return;
    buffer().setEditContent(null);
    patch({ isEditing: false, dirty: false });
    services.syncViewers?.();
    await reloadOpenTabs();
  }
  async function saveActiveFile() {
    if (!active()?.isEditing) return;
    const path = active().path;
    const model = buffer();
    const content = model.editContent;
    try {
      await apiPostJson('api/file/save', { path, content });
      if (store.buffers.get(path) !== model) return;
      if (model.editContent === content) store.actions.patchDocument(path, { dirty: false });
      toast('success', 'Saved ' + path);
      services.saved?.();
    } catch (error) {
      toast('error', error.message);
    }
  }
  async function reloadOpenTabs() {
    await Promise.allSettled(
      store.state.documents.tabs.map(async (document) => {
        const model = store.buffers.get(document.path);
        model.reset();
        const result = await model.loadChunk(Math.floor((document.cur - 1) / 1000));
        if (store.buffers.get(document.path) !== model) return;
        store.actions.patchDocument(document.path, {
          cur: Math.max(1, Math.min(result?.total || 1, document.cur)),
          outline: null,
        });
        services.loadGutter?.(document.path);
      }),
    );
    refresh();
    services.syncViewers?.();
  }
  return {
    enterEditMode,
    exitEditMode,
    saveActiveFile,
    centerEditLine,
    reloadOpenTabs,
  };
}
