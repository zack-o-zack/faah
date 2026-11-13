import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { DiffRows } from './DiffRows.jsx';

export function DiffSection(props) {
  const editor = useEditor();
  const collapsed = () =>
    props.document[props.kind + 'Collapsed'] ?? props.defaultCollapsed ?? false;
  return (
    <section
      class={`diff-section diff-section-${props.kind}`}
      classList={{ collapsed: collapsed() }}
    >
      <Show when={!props.bare}>
        <div
          data-ui="diff-section-head"
          class="flex flex-wrap items-center gap-2 p-3 bg-muted cursor-pointer"
          onClick={() => editor.actions.toggleSection(props.document, props.kind, collapsed())}
        >
          <span data-ui="diff-section-title" class="label">
            {props.title}
          </span>
          <span data-ui="diff-section-sub" class="text-muted-foreground">
            {props.subtitle}
          </span>
          <span class="flex-1" />
          <button
            class="btn"
            data-control="pr-comments-collapse diff-section-collapse"
            data-variant="ghost"
            data-size="icon-xs"
            aria-label="Collapse or expand diff section"
          >
            <span class="icon-[lucide--chevron-down] size-3.5" />
          </button>
        </div>
      </Show>
      <div class="diff-section-body">
        <Show
          when={props.hunks.length}
          fallback={
            <p data-ui="diff-section-note" class="p-3 text-muted-foreground">
              No changes in this section.
            </p>
          }
        >
          <For each={props.hunks}>
            {(original, index) => {
              const hunk = () => props.expanded.get(original) || original;
              return (
                <>
                  <div
                    data-ui="diff-hunk-head"
                    class="flex items-center gap-2 p-3 bg-muted text-muted-foreground"
                    data-new-start={hunk().newStart}
                  >
                    <span
                      data-ui="diff-hunk-label"
                      class="overflow-hidden whitespace-nowrap text-ellipsis"
                    >
                      @@ -{hunk().oldStart} +{hunk().newStart} @@ {hunk().section}
                    </span>
                    <span class="flex-1" />
                    <button
                      class="btn"
                      data-control="diff-hunk-btn diff-hunk-expand"
                      data-variant="ghost"
                      data-size="xs"
                      data-hunk-expand={index()}
                      onClick={() => props.actions.expand(hunk())}
                    >
                      <span class="icon-[lucide--chevrons-up-down] size-3" aria-hidden="true" />{' '}
                      Expand
                    </button>
                    <Show when={props.canAct}>
                      <For each={['stage', 'unstage', 'discard']}>
                        {(action) => (
                          <button
                            class="btn"
                            data-control="diff-hunk-btn"
                            data-hunk-act={action}
                            data-size="xs"
                            data-variant="outline"
                            onClick={() => props.actions.apply(hunk(), action)}
                          >
                            {action[0].toUpperCase() + action.slice(1)}
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                  <Show when={props.document.diffMode} keyed>
                    {(mode) => (
                      <DiffRows
                        hunk={hunk()}
                        mode={mode}
                        document={props.document}
                        diagnostics={props.diagnostics}
                        reviewable={props.reviewable}
                        registerRows={props.registerRows}
                        top={props.top}
                        height={props.height}
                        jump={props.jump}
                      />
                    )}
                  </Show>
                </>
              );
            }}
          </For>
        </Show>
      </div>
    </section>
  );
}
