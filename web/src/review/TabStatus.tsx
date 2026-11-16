import type { JSX } from 'solid-js';
import { createMemo, Show } from 'solid-js';

export type TabStatusState =
  'failed' | 'running' | 'queued' | 'pending' | 'passed' | 'skipped' | 'neutral';
const ORDER: TabStatusState[] = [
  'failed',
  'running',
  'queued',
  'pending',
  'passed',
  'skipped',
  'neutral',
];
const STATUS_MAP: Record<string, TabStatusState> = {
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
export function tabStatus(status: string): TabStatusState {
  return STATUS_MAP[status] || 'pending';
}

type TabStatusProps = { loading?: boolean; error?: boolean } & (
  { noun: 'checks' | 'stages'; statuses: TabStatusState[] } | { noun: 'files'; count: number }
);

export function TabStatus(props: TabStatusProps): JSX.Element {
  const summary = createMemo(() => {
    if (props.loading) return;
    let label = 'Stages';
    if (props.noun === 'files') label = 'Changed files';
    if (props.noun === 'checks') label = 'Checks';
    if (props.error)
      return {
        text: '',
        title: `${label}: couldn't load`,
        icon: 'icon-[ph--x-circle] text-destructive',
      };
    if (props.noun === 'files')
      return { text: String(props.count), title: `${label}: ${props.count}`, icon: '' };
    const total = props.statuses.length;
    if (!total) return;
    const counts: Record<TabStatusState, number> = {
      failed: 0,
      running: 0,
      queued: 0,
      pending: 0,
      passed: 0,
      skipped: 0,
      neutral: 0,
    };
    for (const status of props.statuses) counts[status]++;
    const remaining = counts.running + counts.queued + counts.pending;
    let text = String(total);
    let icon = '';
    if (counts.failed) {
      text = String(counts.failed);
      icon = 'icon-[ph--x-circle] text-destructive';
    } else if (counts.running || counts.queued || (counts.pending && remaining < total)) {
      text = `${total - remaining}/${total}`;
      icon = 'icon-[ph--circle-notch] text-warn motion-safe:animate-spin';
    }
    const title =
      label +
      ': ' +
      ORDER.filter((status) => counts[status])
        .map((status) => `${counts[status]} ${status}`)
        .join(', ');
    return { title, text, icon };
  });
  return (
    <Show when={summary()}>
      {(value) => (
        <span
          data-tab-info
          class="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground group-aria-selected/tab:text-foreground"
          title={value().title}
          aria-label={value().title}
        >
          <Show when={value().icon}>
            <span class={`${value().icon} size-3 shrink-0`} aria-hidden="true" />
          </Show>
          {value().text}
        </span>
      )}
    </Show>
  );
}
