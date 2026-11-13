import { onCleanup } from 'solid-js';
import { api, apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { serializeHunk } from './diff-parse.js';
import { expandContext } from './diff-rows.js';

export function createDiffActions(editor, document, replace, refresh) {
  const controller = new AbortController();
  let fullFile;
  let pending;
  onCleanup(() => controller.abort());
  const current = () =>
    !controller.signal.aborted && editor.store.state.documents.tabs.includes(document());
  return {
    async apply(hunk, action) {
      if (
        action === 'discard' &&
        !confirm('Discard this hunk in the working tree? This cannot be undone.')
      )
        return;
      try {
        await apiPostJson(
          'api/git/hunk',
          { path: document().path, hunk: serializeHunk(hunk), action },
          { signal: controller.signal },
        );
        if (!current()) return;
        toast(
          'success',
          { stage: 'Staged hunk', unstage: 'Unstaged hunk', discard: 'Discarded hunk' }[action],
        );
        refresh();
      } catch (error) {
        if (current()) toast('error', 'Hunk ' + action + ' failed: ' + error.message);
      }
    },
    async expand(hunk) {
      try {
        if (!fullFile) {
          pending ||= api(
            'api/file',
            { path: document().path, raw: '1', ref: document().diffRef || '' },
            { signal: controller.signal },
          );
          fullFile = await pending;
        }
        if (current()) replace(hunk, expandContext(hunk, fullFile.raw || [], fullFile.lines || []));
      } catch (error) {
        pending = null;
        if (current()) toast('error', 'Cannot expand context: ' + error.message);
      }
    },
  };
}
