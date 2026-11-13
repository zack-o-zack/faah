import type { DocTab } from '../editor/types.ts';
import type { GitSnapshot } from '../workspace/decode.ts';
export function documentGitPlan(
  documents: Partial<DocTab>[],
  snapshot: GitSnapshot,
  reviewing: boolean,
): { close: number[]; patch: { path: string; diffAvailable: boolean }[]; reload: boolean } {
  const close = [],
    patch = [];
  let reload = false;
  for (let index = 0; index < documents.length; index++) {
    const document = documents[index];
    if (!document?.path || document.diffRef) continue;
    const status = snapshot.statuses?.[document.path];
    const available = !!status && status !== 'U';
    if (
      !reviewing &&
      !document.dirty &&
      !document.isEditing &&
      (document.diffMode || document.openedInDiffView) &&
      (document.diffAvailable || document.diffMode) &&
      !available
    )
      close.push(index);
    else if (available) reload = true;
    else if (document.diffAvailable !== available)
      patch.push({ path: document.path, diffAvailable: available });
  }
  return { close, patch, reload };
}
