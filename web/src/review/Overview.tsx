import { pluralize } from '../pr/logic.ts';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { PRCheck, PRCheckState, PRReviewer, PRReviewState, PROverview } from '../pr/types.ts';
import { useEditor } from '../editor/context.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { errorMessage } from '../lib/decode.ts';
import { safeMarkdownURL } from '../lib/markdown-model.ts';
import { OverviewDescription } from './OverviewDescription.tsx';
import { Activity } from '../pr/Activity.tsx';
import {
  CHECK_LABELS,
  CHECK_ORDER,
  REVIEW_LABELS,
  analyzeChecks,
  reviewSummary,
  sortedReviewers,
  openedDate,
  showingChecks,
} from './overview-logic.ts';

const CHECK_ICONS: Record<PRCheckState, string> = {
  passed: 'icon-[ph--check-circle] text-gi',
  failed: 'icon-[ph--x-circle] text-destructive',
  running: 'icon-[ph--circle-notch] text-warn motion-safe:animate-spin',
  skipped: 'icon-[ph--minus-circle] text-muted-foreground',
  neutral: 'icon-[ph--circle] text-muted-foreground',
};
const REVIEW_ICONS: Record<PRReviewState, string> = {
  approved: 'icon-[ph--check]',
  changes_requested: 'icon-[ph--warning-circle]',
  commented: 'icon-[ph--chat-circle]',
  pending: 'icon-[ph--clock]',
};
const CHECK_TONES: Record<PRCheckState, string> = {
  passed: 'text-gi',
  failed: 'text-destructive',
  running: 'text-warn',
  skipped: 'text-muted-foreground',
  neutral: 'text-muted-foreground',
};
const REVIEW_TONES: Record<PRReviewState, string> = {
  approved: 'text-gi',
  changes_requested: 'text-destructive',
  commented: 'text-muted-foreground',
  pending: 'text-muted-foreground',
};

function Avatar(props: { name: string; url: string }): JSX.Element {
  return (
    <span class="avatar size-7 rounded-full" data-size="sm">
      <span class="bg-muted" aria-hidden="true">
        {props.name.slice(0, 1).toUpperCase()}
      </span>
      <Show when={safeMarkdownURL(props.url)}>
        {(url) => <img src={url()} alt={props.name} loading="lazy" referrerpolicy="no-referrer" />}
      </Show>
    </span>
  );
}
function OverviewLayout(props: { sidebar: JSX.Element; children: JSX.Element }): JSX.Element {
  return (
    <div
      style={{ '--overview-offset': '1rem' }}
      class="mx-auto grid w-full max-w-7xl items-start gap-7 pt-(--overview-offset) lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10"
    >
      <aside
        aria-label="PR status"
        class="min-w-0 bg-background pb-4 lg:sticky lg:top-(--overview-offset) lg:max-h-[calc(100cqh-var(--overview-offset))] lg:overflow-y-auto lg:col-start-2 lg:row-start-1"
      >
        {props.sidebar}
      </aside>
      <div class="min-w-0 lg:col-start-1 lg:row-start-1">{props.children}</div>
    </div>
  );
}
function OverviewSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading overview">
      <span class="sr-only">Loading overview…</span>
      <OverviewLayout
        sidebar={
          <div aria-hidden="true" class="space-y-6">
            <div class="skeleton h-4 w-24 motion-reduce:animate-none" />
            <For each={[0, 1, 2, 3]}>
              {() => <div class="skeleton h-6 w-full motion-reduce:animate-none" />}
            </For>
            <hr role="separator" class="border-border" />
            <div class="skeleton h-4 w-24 motion-reduce:animate-none" />
            <For each={[0, 1, 2]}>
              {() => <div class="skeleton h-7 w-full motion-reduce:animate-none" />}
            </For>
          </div>
        }
      >
        <div aria-hidden="true" class="space-y-5">
          <div class="skeleton h-7 w-40 motion-reduce:animate-none" />
          <div class="skeleton h-9 w-3/4 motion-reduce:animate-none" />
          <For each={[0, 1, 2, 3, 4, 5]}>
            {() => <div class="skeleton h-4 w-full motion-reduce:animate-none" />}
          </For>
        </div>
      </OverviewLayout>
    </div>
  );
}
function CheckRow(props: { check: PRCheck; grouped?: boolean }): JSX.Element {
  return (
    <li
      class="item group min-w-0 gap-2! py-1.5!"
      classList={{
        'pl-[calc(var(--check-inset)+var(--check-icon)+var(--check-gap))]!': props.grouped,
      }}
      data-size="sm"
      data-check-state={props.check.state}
    >
      <figure>
        <span
          class={`${CHECK_ICONS[props.check.state]} size-3.5 shrink-0`}
          role="img"
          aria-label={CHECK_LABELS[props.check.state]}
        />
      </figure>
      <section class="min-w-0 truncate" title={props.check.name}>
        <Show when={safeMarkdownURL(props.check.url)} fallback={props.check.name}>
          {(url) => (
            <a
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
              class="block truncate underline-offset-4 hover:underline"
            >
              {props.check.name}
            </a>
          )}
        </Show>
      </section>
      <Show when={safeMarkdownURL(props.check.url)}>
        <aside class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <span class="icon-[ph--arrow-square-out] text-muted-foreground" aria-hidden="true" />
        </aside>
      </Show>
    </li>
  );
}
function CheckGroup(props: { state: PRCheckState; checks: PRCheck[] }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [limit, setLimit] = createSignal(40);
  return (
    <li
      data-check-group={props.state}
      style={{ '--check-icon': '0.875rem', '--check-gap': '0.5rem', '--check-inset': '0.75rem' }}
    >
      <button
        type="button"
        class="btn w-full justify-start gap-(--check-gap)! px-(--check-inset)!"
        data-variant="ghost"
        data-size="sm"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span
          class={`${CHECK_ICONS[props.state]} size-(--check-icon) shrink-0`}
          aria-hidden="true"
        />
        <span data-check-group-label>{pluralize(props.checks.length, `${props.state} check`)}</span>
      </button>
      <Show when={open()}>
        <ul>
          <For each={props.checks.slice(0, limit())}>
            {(check) => <CheckRow check={check} grouped />}
          </For>
        </ul>
        <Show when={props.checks.length > limit()}>
          <button
            class="btn w-full"
            data-variant="ghost"
            data-size="sm"
            onClick={() => setLimit(limit() + 40)}
          >
            Show more {props.state} ({props.checks.length - limit()} remaining)
          </button>
        </Show>
      </Show>
    </li>
  );
}
function Checks(props: { checks: PRCheck[]; truncated: boolean; total: number }): JSX.Element {
  const [filter, setFilter] = createSignal('');
  const analysis = createMemo(() => analyzeChecks(props.checks));
  const filtered = createMemo(() => {
    const query = filter().trim().toLocaleLowerCase();
    return analysis().groups.map((group) => ({
      ...group,
      checks: group.checks.filter((check) => check.name.toLocaleLowerCase().includes(query)),
    }));
  });
  const counts = () => analysis().counts;
  const summary = () =>
    counts()
      .map((row) => `${row.count} ${row.state}`)
      .join(', ');
  return (
    <section aria-label="Checks" class="min-w-0">
      <header class="mb-3 space-y-2">
        <h2 class="flex items-center gap-2 font-display text-sm font-semibold">
          Checks
          <span class="badge" data-variant="secondary">
            {props.checks.length}
          </span>
        </h2>
        <Show when={props.checks.length}>
          <div class="flex flex-wrap gap-x-2 text-xs" aria-label={summary()}>
            <For each={counts()}>
              {(row) => (
                <span class={CHECK_TONES[row.state]}>
                  {row.count} {row.state}
                </span>
              )}
            </For>
          </div>
          <div
            class="progress"
            data-checks
            role="img"
            aria-label={'Check proportions: ' + summary()}
          >
            <For each={counts()}>
              {(segment) => (
                <span data-state={segment.state} style={{ 'flex-grow': segment.count }} />
              )}
            </For>
          </div>
        </Show>
      </header>
      <Show
        when={props.checks.length}
        fallback={<p class="text-sm text-muted-foreground">No checks</p>}
      >
        <Show when={props.truncated}>
          <p class="mb-2 text-xs text-muted-foreground">
            {showingChecks(props.checks.length, props.total)}
          </p>
        </Show>
        <Show when={props.checks.length > 20}>
          <input
            class="input mb-2 w-full"
            aria-label="Filter checks"
            placeholder="Filter checks…"
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
        </Show>
        <ul aria-label="Checks" class="space-y-0.5">
          <For each={CHECK_ORDER}>
            {(state) => {
              const checks = () => filtered().find((group) => group.state === state)?.checks || [];
              return (
                <Show when={checks().length}>
                  <Show
                    when={state === 'failed' || state === 'running'}
                    fallback={<CheckGroup state={state} checks={checks()} />}
                  >
                    <For each={checks()}>{(check) => <CheckRow check={check} />}</For>
                  </Show>
                </Show>
              );
            }}
          </For>
        </ul>
      </Show>
    </section>
  );
}
function Reviewers(props: { reviewers: PRReviewer[] }): JSX.Element {
  return (
    <section aria-label="Reviewers" class="min-w-0">
      <header class="mb-3 space-y-1">
        <h2 class="font-display text-sm font-semibold">Reviewers</h2>
        <Show when={props.reviewers.length}>
          <p class="text-xs text-muted-foreground">{reviewSummary(props.reviewers)}</p>
        </Show>
      </header>
      <Show
        when={props.reviewers.length}
        fallback={<p class="text-sm text-muted-foreground">No reviewers</p>}
      >
        <ul aria-label="Reviewers" class="space-y-1">
          <For each={sortedReviewers(props.reviewers)}>
            {(reviewer) => (
              <li
                class="item min-w-0 gap-2! px-0! py-1.5!"
                data-size="sm"
                data-review-state={reviewer.state}
              >
                <figure>
                  <Avatar name={reviewer.name} url={reviewer.avatarUrl} />
                </figure>
                <section class="min-w-0 truncate text-sm" title={reviewer.name}>
                  {reviewer.name}
                </section>
                <aside
                  class={`flex shrink-0 items-center gap-1 text-xs ${REVIEW_TONES[reviewer.state]}`}
                >
                  <span class={`${REVIEW_ICONS[reviewer.state]} size-3`} aria-hidden="true" />
                  {REVIEW_LABELS[reviewer.state]}
                </aside>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
function Description(props: { data: PROverview; url: string }): JSX.Element {
  const description = () => props.data.description;
  const date = () => openedDate(description().createdAt);
  return (
    <>
      <Show when={description().author}>
        <header class="mb-5 flex items-center gap-2 text-sm">
          <Avatar name={description().author} url={description().avatarUrl} />
          <span class="font-medium">{description().author}</span>
          <Show when={date()}>
            <span class="text-muted-foreground">
              opened{' '}
              <time dateTime={description().createdAt} title={description().createdAt}>
                {date()}
              </time>
            </span>
          </Show>
        </header>
      </Show>
      <Show
        when={description().body.trim()}
        fallback={<p class="text-sm text-muted-foreground">No description</p>}
      >
        <OverviewDescription description={description()} prURL={props.url} />
      </Show>
    </>
  );
}
export function Overview(): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  return (
    <div
      id="pr-overview"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain [container-type:size] px-4 pb-8 lg:px-6"
      role="tabpanel"
      aria-label="Overview"
      aria-labelledby="btn-review-tab-overview"
      aria-busy={review.overview.loading}
    >
      <Show
        when={!review.overview.loading || review.overviewData()}
        fallback={<OverviewSkeleton />}
      >
        <Show
          when={!review.overview.error}
          fallback={
            <div class="pt-4">
              <ErrorNotice
                error={errorMessage(review.overview.error)}
                title="Could not load PR overview"
              >
                <button
                  type="button"
                  class="btn mt-2"
                  data-variant="outline"
                  data-size="sm"
                  onClick={review.actions.refreshReview}
                >
                  Retry
                </button>
              </ErrorNotice>
            </div>
          }
        >
          <Show when={review.overviewData()}>
            {(data) => (
              <OverviewLayout
                sidebar={
                  <>
                    <Checks
                      checks={data().checks}
                      truncated={data().truncated}
                      total={data().totalChecks}
                    />
                    <hr role="separator" class="my-5 border-border" />
                    <Reviewers reviewers={data().reviewers} />
                  </>
                }
              >
                <Description data={data()} url={editor.store.state.workspace.meta?.pr?.url || ''} />
                <Show when={editor.pr.available()}>
                  <Activity />
                </Show>
              </OverviewLayout>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
