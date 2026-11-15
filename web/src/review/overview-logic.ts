import { pluralize } from '../pr/logic.ts';
import type { PRCheck, PRCheckState, PRReviewer, PRReviewState } from '../pr/types.ts';
export const CHECK_LABELS: Record<PRCheckState, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  skipped: 'Skipped',
  neutral: 'Neutral',
};
export const REVIEW_LABELS: Record<PRReviewState, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  pending: 'Awaiting review',
};
export const CHECK_ORDER: PRCheckState[] = ['failed', 'running', 'neutral', 'skipped', 'passed'];
const REVIEW_ORDER: PRReviewState[] = ['changes_requested', 'approved', 'commented', 'pending'];
export function sortedReviewers(reviewers: PRReviewer[]): PRReviewer[] {
  return [...reviewers].sort(
    (a, b) =>
      REVIEW_ORDER.indexOf(a.state) - REVIEW_ORDER.indexOf(b.state) || a.name.localeCompare(b.name),
  );
}
export function reviewSummary(reviewers: PRReviewer[]): string {
  const labels: Record<PRReviewState, string> = {
    approved: 'approved',
    changes_requested: 'requested changes',
    commented: 'commented',
    pending: 'awaiting',
  };
  return (['approved', 'changes_requested', 'commented', 'pending'] as PRReviewState[])
    .flatMap((state) => {
      const count = reviewers.filter((reviewer) => reviewer.state === state).length;
      return count ? [`${count} ${labels[state]}`] : [];
    })
    .join(', ');
}
export function openedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function analyzeChecks(checks: PRCheck[]) {
  const groups = CHECK_ORDER.map((state) => ({ state, checks: [] as PRCheck[] }));
  const byState = new Map(groups.map((group) => [group.state, group]));
  for (const check of checks) byState.get(check.state)?.checks.push(check);
  for (const group of groups) group.checks.sort((a, b) => a.name.localeCompare(b.name));
  const counts = groups
    .filter((group) => group.checks.length)
    .map((group) => ({ state: group.state, count: group.checks.length }));
  counts.sort(
    (a, b) =>
      ['failed', 'running', 'passed', 'neutral', 'skipped'].indexOf(a.state) -
      ['failed', 'running', 'passed', 'neutral', 'skipped'].indexOf(b.state),
  );
  return { groups, counts };
}

export function showingChecks(shown: number, total: number): string {
  return total
    ? `Showing first ${shown} of ${pluralize(total, 'check')}`
    : `Showing first ${pluralize(shown, 'check')}`;
}
