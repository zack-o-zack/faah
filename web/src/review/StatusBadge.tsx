import type { JSX } from 'solid-js';
import { createMemo, Show } from 'solid-js';

export type BadgeStatus =
  'failed' | 'running' | 'queued' | 'pending' | 'passed' | 'skipped' | 'neutral';
const ORDER: BadgeStatus[] = [
  'failed',
  'running',
  'queued',
  'pending',
  'passed',
  'skipped',
  'neutral',
];
const STATUS_MAP: Record<string, BadgeStatus> = {
  failed: 'failed',
  running: 'running',
  pending: 'pending',
  queued: 'queued',
  completed: 'passed',
  passed: 'passed',
  stopped: 'skipped',
  skipped: 'skipped',
  neutral: 'neutral',
};
export function badgeStatus(status: string): BadgeStatus {
  return STATUS_MAP[status] || 'pending';
}

export function StatusBadge(props: {
  statuses: BadgeStatus[];
  noun: 'checks' | 'stages';
}): JSX.Element {
  const summary = createMemo(() => {
    const counts: Record<BadgeStatus, number> = {
      failed: 0,
      running: 0,
      queued: 0,
      pending: 0,
      passed: 0,
      skipped: 0,
      neutral: 0,
    };
    for (const status of props.statuses) counts[status]++;
    const total = props.statuses.length;
    const remaining = counts.running + counts.queued + counts.pending;
    let text = String(total);
    let icon = 'icon-[lucide--circle-check] text-gi';
    if (counts.failed) {
      text = `${counts.failed} failed`;
      icon = 'icon-[lucide--circle-x] text-destructive';
    } else if (counts.running || counts.queued || (counts.pending && remaining < total)) {
      text = `${total - remaining}/${total}`;
      icon = 'icon-[lucide--loader-circle] text-warn motion-safe:animate-spin';
    } else if (counts.pending) icon = 'icon-[lucide--circle-dashed] text-muted-foreground';
    const title =
      (props.noun === 'checks' ? 'Checks' : 'Stages') +
      ': ' +
      ORDER.filter((status) => counts[status])
        .map((status) => `${counts[status]} ${status}`)
        .join(', ');
    return { total, title, text, icon };
  });
  return (
    <Show when={summary().total}>
      <span
        class="badge gap-1 tabular-nums"
        data-variant="outline"
        title={summary().title}
        aria-label={summary().title}
      >
        <span class={`${summary().icon} size-3 shrink-0`} aria-hidden="true" />
        {summary().text}
      </span>
    </Show>
  );
}
