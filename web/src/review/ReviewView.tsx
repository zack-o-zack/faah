import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { Overview } from './Overview.tsx';
import { useEditor } from '../editor/context.tsx';
import { ReviewTabs } from './ReviewTabs.tsx';
import { Walkthrough } from './Walkthrough.tsx';
import { StageList } from './StageList.tsx';
import { StageView } from './StageView.tsx';
export function ReviewView(): JSX.Element {
  const review = useEditor().review;
  return (
    <Show when={review.state.mode === 'review'}>
      <div
        id="review-view"
        class={`group/review relative flex min-h-min flex-1 flex-col overflow-hidden layout-${review.state.layout}`}
      >
        <ReviewTabs />
        {/* Tab contents scroll within this space instead of contributing their full intrinsic height. */}
        <div class="flex min-h-24 flex-1 flex-col overflow-hidden [contain:size]">
          <Switch>
            <Match when={review.state.tab === 'overview'}>
              <Overview />
            </Match>
            <Match when={review.state.tab === 'walkthrough'}>
              <Walkthrough />
            </Match>
            <Match when={review.state.tab === 'stages'}>
              <div
                id="review-stages-view"
                role="tabpanel"
                aria-labelledby="btn-review-tab-stages"
                class="flex min-h-0 flex-1 overflow-hidden group-[.layout-horizontal]/review:flex-col"
              >
                <StageList />
                <StageView />
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  );
}
