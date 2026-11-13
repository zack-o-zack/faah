import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ReviewTabs } from './ReviewTabs.jsx';
import { Walkthrough } from './Walkthrough.jsx';
import { StageList } from './StageList.jsx';
import { StageView } from './StageView.jsx';
export function ReviewView() {
  const review = useEditor().review;
  return (
    <Show when={review.state.mode === 'review'}>
      <div
        id="review-view"
        class={`group/review relative flex min-h-0 flex-1 flex-col overflow-hidden layout-${review.state.layout}`}
      >
        <ReviewTabs />
        <Show when={review.state.tab === 'stages'} fallback={<Walkthrough />}>
          <div
            id="review-stages-view"
            class="flex min-h-0 flex-1 overflow-hidden group-[.layout-horizontal]/review:flex-col"
          >
            <StageList />
            <StageView />
          </div>
        </Show>
      </div>
    </Show>
  );
}
