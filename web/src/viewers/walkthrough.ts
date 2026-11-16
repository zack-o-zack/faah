import { createEffect, createMemo, createResource, on, onCleanup } from 'solid-js';
import type { AppStore } from '../app/store.ts';
import type { Geometry } from '../editor/contracts.ts';
import type { OpenOptions } from '../editor/types.ts';
import type { WalkthroughFile } from '../review/types.ts';
import { missingLines, type ContextRange } from '../review/context.ts';
import { reviewRangeText } from './walkthrough-review.ts';
import { isPreview } from './view.ts';
import { walkStep } from './orb-model.ts';

export function createWalkthrough(
  store: AppStore,
  geometry: Geometry,
  actions: {
    openFile: (path: string, options?: OpenOptions) => Promise<void>;
    centerLine: (line: number) => void;
  },
  review?: {
    ready?(): boolean;
    revision?(): number;
    files(): WalkthroughFile[];
    expand(path: string, ranges: ContextRange[]): Promise<boolean>;
    reveal(path: string, line: number): void;
    showTab(): void;
    openReference(target: { path: string; line: number; end: number }): Promise<void>;
  },
) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const step = createMemo(() => walkStep(store.state.explanation));
  const reviewWalk = () => store.state.explanation.walk?.surface === 'review';
  const diffText = createMemo(() => {
    const target = step();
    if (!target || !reviewWalk()) return null;
    const file = review?.files().find((file) => file.path === target.path);
    return file ? reviewRangeText(file, target.l1, target.l2) : null;
  });
  const inReview = () => !!reviewWalk() && diffText() !== null && loaded()?.review === true;
  const key = createMemo(() => {
    if (reviewWalk() && review?.ready && !review.ready()) return false;
    const target = step();
    const state = store.state.explanation;
    return target
      ? JSON.stringify([
          reviewWalk(),
          reviewWalk() ? review?.revision?.() : 0,
          state.model?.id,
          state.model?.turn,
          state.walk,
          target.path,
          target.l1,
          target.l2,
        ])
      : false;
  });
  const [file, { refetch }] = createResource(key, async (identity) => {
    const current = () => !disposed && key() === identity;
    const target = step();
    if (!target) return { key: identity, review: false, missing: true };
    if (reviewWalk() && review) {
      const file = review.files().find((file) => file.path === target.path && file.status !== 'D');
      const ranges = file ? missingLines(file, target.l1, target.l2) : [];
      const expanded = file && (!ranges.length || (await review.expand(target.path, ranges)));
      if (!current()) return { key: identity, review: false, missing: false };
      const expandedFile = review.files().find((file) => file.path === target.path);
      if (
        expanded &&
        expandedFile &&
        reviewRangeText(expandedFile, target.l1, target.l2) !== null
      ) {
        review.showTab();
        const paneHeight =
          globalThis.document.getElementById('review-diff-pane')?.clientHeight || geometry.height;
        const tall = (target.l2 - target.l1 + 1) * geometry.lineHeight > paneHeight;
        review.reveal(target.path, tall ? target.l1 : Math.floor((target.l1 + target.l2) / 2));
        return { key: identity, review: true, missing: false };
      }
      await review.openReference({ path: target.path, line: target.l1, end: target.l2 });
    } else await actions.openFile(target.path, { line: target.l1, view: 'source' });
    if (!current()) return { key: identity, review: false, missing: false };
    const document = store.activeDocument();
    if (
      !document ||
      document.path !== target.path ||
      document.deleted ||
      document.isImage ||
      !document.total
    )
      return { key: identity, review: false, missing: true };
    const buffer = store.buffers.get(target.path);
    try {
      await buffer?.ensure(
        Math.min(target.l1 - 1, document.total - 1),
        Math.min(target.l2, document.total),
      );
      return { key: identity, review: false, missing: !buffer };
    } catch {
      return { key: identity, review: false, missing: true };
    }
  });
  const loaded = createMemo(() => (file.latest?.key === key() ? file.latest : undefined));
  const missing = () =>
    !inReview() &&
    (!!loaded()?.missing ||
      !!store.state.documents.tabs.find((document) => document.path === step()?.path)?.deleted);
  const focus = createMemo(() => {
    const target = step();
    if (inReview() && target) return target;
    const document = store.activeDocument();
    if (
      !target ||
      !loaded() ||
      missing() ||
      !document ||
      target.path !== document.path ||
      document.isEditing ||
      document.diffMode ||
      isPreview(document)
    )
      return null;
    const l1 = Math.max(1, Math.min(target.l1, document.total));
    return { ...target, l1, l2: Math.max(l1, Math.min(target.l2, document.total)) };
  });
  createEffect(
    on(loaded, () => {
      const target = focus();
      if (!target || inReview()) return;
      const tall = (target.l2 - target.l1 + 1) * geometry.lineHeight > geometry.height;
      actions.centerLine(tall ? target.l1 : Math.floor((target.l1 + target.l2) / 2));
    }),
  );
  const outdated = createMemo(() => {
    const target = step();
    if (target && inReview()) return diffText() !== target.text;
    if (!target || !loaded() || missing()) return false;
    store.bufferRevision();
    const document = store.state.documents.tabs.find((document) => document.path === target.path);
    const buffer = store.buffers.get(target.path);
    buffer?.revision();
    if (!document || !buffer) return false;
    if (target.l1 > document.total || target.l2 > document.total) return true;
    return (
      Array.from({ length: target.l2 - target.l1 + 1 }, (_, index) =>
        buffer.text(target.l1 - 1 + index),
      ).join('\n') !== target.text
    );
  });
  const surface = (): 'source' | 'review' | null => {
    if (!focus()) return null;
    return inReview() ? 'review' : 'source';
  };
  return { step, focus, missing, outdated, surface, reveal: refetch };
}
