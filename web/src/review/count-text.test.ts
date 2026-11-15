import { expect, test } from 'vitest';
import { pluralize, mergeMethodInfo } from '../pr/logic.ts';
import { showingChecks, reviewSummary } from './overview-logic.ts';

test.each([0, 1, 2])('count labels and merge explanations handle %i', (count) => {
  const noun = count === 1 ? 'check' : 'checks';
  for (const state of ['passed', 'skipped', 'neutral'])
    expect(pluralize(count, `${state} check`)).toBe(`${count} ${state} ${noun}`);
  expect(showingChecks(count, 0)).toBe(`Showing first ${count} ${noun}`);
  expect(showingChecks(1, count)).toBe(
    count ? `Showing first 1 of ${count} ${noun}` : 'Showing first 1 check',
  );
  const reviewers = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    name: 'Reviewer',
    avatarUrl: '',
    state: 'changes_requested' as const,
  }));
  expect(reviewSummary(reviewers)).toBe(count ? `${count} requested changes` : '');
  for (const method of ['merge', 'squash', 'rebase']) {
    const text = mergeMethodInfo(method).explain(count, 'main');
    if (!count) expect(text).toMatch(/^No commits from this branch/);
    else
      expect(text).toContain(
        `The ${count} commit${count === 1 ? '' : 's'} from this branch ${count === 1 ? 'is' : 'are'} `,
      );
  }
});
