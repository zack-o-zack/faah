import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';

export function MergeControls(): JSX.Element {
  const editor = useEditor();
  const merge = editor.merge;
  return (
    <button
      id="pr-merge"
      type="button"
      class="btn"
      data-variant="primary"
      data-size="sm"
      disabled={merge.sync().running || merge.state.pending}
      title={
        merge.sync().running
          ? 'Wait for the rebase to finish'
          : `Merge into ${merge.base()} (review the commit first)`
      }
      onClick={() => void editor.actions.openMergeDialog(merge.method())}
    >
      {merge.sync().running ? 'Rebasing...' : 'Merge'}
    </button>
  );
}
