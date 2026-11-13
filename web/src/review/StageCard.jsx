import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ContextMenu } from '../lib/ContextMenu.jsx';
import { DropdownMenu } from '../lib/DropdownMenu.jsx';
import { MenuItem } from '../lib/MenuItem.jsx';
import { STAGE_STATUS, stageStatus } from './logic.ts';
import { StageDot } from './StageDot.jsx';
export function StageCard(props) {
  const editor = useEditor();
  const review = editor.review;
  const title = () => props.stage.def.title || `Stage ${props.index + 1}`;
  const status = () => stageStatus(props.stage);
  const selected = () => review.state.active === props.index;
  return (
    <li class="group relative flex rounded-md" classList={{ 'bg-accent': selected() }}>
      <ContextMenu label="Stage actions" menu={<StageMenuItems index={props.index} />}>
        <button
          type="button"
          aria-pressed={selected()}
          aria-label={`Stage ${props.index + 1}: ${title()}, ${STAGE_STATUS[status()].label}`}
          class="flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-2 pr-8 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
          onClick={() => editor.actions.selectReviewStage(props.index)}
        >
          <span class="relative flex w-2 shrink-0 justify-center self-stretch pt-1.5">
            <StageDot status={status()} class="relative z-10" />
            <Show when={!props.last}>
              <span class="absolute top-4 -bottom-3 w-px bg-border" aria-hidden="true" />
            </Show>
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-sm font-medium wrap-anywhere">{title()}</span>
            <span class="line-clamp-2 text-xs text-muted-foreground wrap-anywhere">
              {props.stage.def.question || ''}
            </span>
          </span>
        </button>
      </ContextMenu>
      <div class="absolute top-1.5 right-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100">
        <DropdownMenu
          label={<span class="icon-[lucide--ellipsis] size-3.5 shrink-0" aria-hidden="true" />}
          accessibleLabel={`Actions for ${title()}`}
          size="icon-xs"
          control="review-stage-menu-btn"
        >
          <StageMenuItems index={props.index} />
        </DropdownMenu>
      </div>
    </li>
  );
}
// Reordering and removing wait while the pipeline runs: run stages match the list by position.
function StageMenuItems(props) {
  const editor = useEditor();
  const review = editor.review;
  const count = () => review.state.config.stages.length;
  return (
    <>
      <MenuItem
        icon="icon-[lucide--sparkle] text-special"
        disabled={review.running()}
        onSelect={() => void editor.actions.runReview(props.index)}
      >
        Run this stage
      </MenuItem>
      <MenuItem
        icon="icon-[lucide--square-pen]"
        onSelect={() => {
          editor.actions.selectReviewStage(props.index);
          editor.actions.openStageEditor(props.index);
        }}
      >
        Edit
      </MenuItem>
      <MenuItem
        icon="icon-[lucide--arrow-up]"
        disabled={review.running() || props.index === 0}
        onSelect={() => void editor.actions.mutateStage(props.index, 'up')}
      >
        Move up
      </MenuItem>
      <MenuItem
        icon="icon-[lucide--arrow-down]"
        disabled={review.running() || props.index === count() - 1}
        onSelect={() => void editor.actions.mutateStage(props.index, 'down')}
      >
        Move down
      </MenuItem>
      <hr role="separator" class="my-1 border-border" />
      <MenuItem
        icon="icon-[lucide--trash-2]"
        class="text-destructive"
        disabled={review.running() || count() <= 1}
        onSelect={() => void editor.actions.mutateStage(props.index, 'remove')}
      >
        Remove
      </MenuItem>
    </>
  );
}
