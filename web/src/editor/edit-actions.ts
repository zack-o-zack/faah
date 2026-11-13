import { decodeSave } from './decode.ts';
import type { EditorHost } from './contracts.ts';
import { errorMessage, isAbort } from '../lib/decode.ts';
import { onCleanup } from 'solid-js';
import { apiPostJson, apiText } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';

export function createEditActions(editor: EditorHost): ReturnType<typeof buildEditActions> {
  return buildEditActions(editor);
}
function buildEditActions(editor: EditorHost) {
  const { active, buffer, store, services, setUI } = editor;
  const { patch, refresh } = editor.actions;
  onCleanup(() => editRequest?.abort());
  let editRequest: AbortController | undefined;
  async function enterEditMode(line?: number) {
    const document = active();
    if (!document || document.isImage || document.deleted || document.diffRef) return;
    if (
      (document.total > 10000 || document.size > 1024 * 1024) &&
      !confirm(`"${document.name}" is large. Load it for editing?`)
    )
      return;
    const model = buffer();
    if (!model) return;
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
        if (!isAbort(error)) {
          setUI('editError', errorMessage(error));
          toast('error', errorMessage(error));
        }
        return;
      } finally {
        setUI('editLoading', false);
      }
    }
    store.actions.patchDocument(document.path, { isEditing: true, diffMode: null });
    if (active()?.path !== document.path) return;
    queueMicrotask(() => centerEditLine(line || document.cur));
  }
  function centerEditLine(line: number, start?: number, end?: number) {
    services.edit?.center(line, start, end);
  }
  async function exitEditMode(force = false) {
    const document = active();
    if (!document?.isEditing) return;
    if (document.dirty && !force && !confirm('You have unsaved changes. Discard changes?')) return;
    buffer()?.setEditContent(null);
    patch({ isEditing: false, dirty: false });
    await reloadOpenTabs();
  }
  async function saveActiveFile() {
    const document = active();
    if (!document?.isEditing) return;
    const path = document.path;
    const model = buffer();
    if (!model) return;
    const content = model.editContent;
    try {
      decodeSave(await apiPostJson('api/file/save', { path, content }));
      if (store.buffers.get(path) !== model) return;
      if (model.editContent === content) store.actions.patchDocument(path, { dirty: false });
      toast('success', 'Saved ' + path);
      void editor.actions.refreshWorkspace();
    } catch (error) {
      toast('error', errorMessage(error));
    }
  }
  async function reloadOpenTabs({ onlyIfChanged = false } = {}) {
    await Promise.allSettled(
      store.state.documents.tabs.map(async (document) => {
        if (document.diffRef || document.dirty || document.isEditing || document.isImage) return;
        const model = store.buffers.get(document.path);
        if (!model) return;
        if (!onlyIfChanged) model.reset();
        const result = await model.loadChunk(Math.floor((document.cur - 1) / 1000), {
          force: onlyIfChanged,
          onlyIfChanged,
        });
        if (store.buffers.get(document.path) !== model || result?.unchanged) return;
        store.actions.patchDocument(document.path, {
          cur: Math.max(1, Math.min(result?.total || 1, document.cur)),
          outline: null,
        });
        editor.actions.loadGutter(document.path);
      }),
    );
    refresh();
  }
  return {
    enterEditMode,
    exitEditMode,
    saveActiveFile,
    centerEditLine,
    reloadOpenTabs,
  };
}
