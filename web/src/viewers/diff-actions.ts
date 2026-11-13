import type { Accessor } from 'solid-js';
import type { EditorHost } from '../editor/contracts.ts';
import type { DocTab } from '../editor/types.ts';
import type { DiffHunk } from './diff-parse.ts';
import type { FileWindow } from '../editor/decode.ts';
import { decodeFileWindow } from '../editor/decode.ts';
import { errorMessage } from '../lib/decode.ts';
import { onCleanup } from 'solid-js';
import { api, apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { serializeHunk } from './diff-parse.ts';
import { expandContext } from './diff-rows.ts';

export function createDiffActions(
  editor: EditorHost,
  document: Accessor<DocTab>,
  replace: (hunk: DiffHunk, replacement: DiffHunk) => void,
  refresh: () => void,
): ReturnType<typeof buildDiffActions> {
  return buildDiffActions(editor, document, replace, refresh);
}
function buildDiffActions(
  editor: EditorHost,
  document: Accessor<DocTab>,
  replace: (hunk: DiffHunk, replacement: DiffHunk) => void,
  refresh: () => void,
) {
  const controller = new AbortController();
  let fullFile: FileWindow | undefined;
  let pending: Promise<unknown> | null = null;
  onCleanup(() => controller.abort());
  const current = () =>
    !controller.signal.aborted && editor.store.state.documents.tabs.includes(document());
  return {
    async apply(hunk: DiffHunk, action: 'stage' | 'unstage' | 'discard'): Promise<void> {
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
        if (current()) toast('error', 'Hunk ' + action + ' failed: ' + errorMessage(error));
      }
    },
    async expand(hunk: DiffHunk): Promise<void> {
      try {
        if (!fullFile) {
          pending ||= api(
            'api/file',
            { path: document().path, raw: '1', ref: document().diffRef || '' },
            { signal: controller.signal },
          );
          fullFile = decodeFileWindow(await pending);
        }
        if (current()) replace(hunk, expandContext(hunk, fullFile.raw || [], fullFile.lines || []));
      } catch (error) {
        pending = null;
        if (current()) toast('error', 'Cannot expand context: ' + errorMessage(error));
      }
    },
  };
}
