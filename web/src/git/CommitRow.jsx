import { createSignal, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { copyText } from '../lib/clipboard.ts';
import { CommitFiles } from './CommitFiles.jsx';
import { CommitDetails } from './CommitDetails.jsx';
import { commitIdentity } from './logic.ts';
export function CommitRow(props) {
  const editor = useEditor();
  const [expanded, setExpanded] = createSignal(false);
  const sha = () => commitIdentity(props.commit);
  async function first() {
    setExpanded(true);
    const files = await editor.actions.loadCommitFiles(sha());
    if (files[0]) await editor.actions.openCommitFile(sha(), files[0]);
  }
  return (
    <div
      class={props.unpushed ? 'up-commit' : 'git-commit'}
      data-sha={sha()}
      classList={{ expanded: expanded(), open: expanded() }}
    >
      <CommitDetails sha={sha()} sideWidth={editor.store.state.layout.leftWidth}>
        {(hover) => (
          <div
            role="button"
            tabindex="0"
            class={
              props.unpushed
                ? 'up-row flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline-ring focus-visible:outline'
                : 'git-commit-row flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline-ring focus-visible:outline'
            }
            title={props.commit.subject || ''}
            aria-expanded={expanded()}
            onMouseEnter={hover.onMouseEnter}
            onMouseLeave={hover.onMouseLeave}
            onClick={() => {
              hover.hide();
              setExpanded(!expanded());
            }}
            onDblClick={() => void first()}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') setExpanded(true);
              else if (event.key === 'ArrowLeft') setExpanded(false);
              else if (event.key === 'Enter') {
                event.preventDefault();
                void first();
              }
            }}
          >
            <Show
              when={props.unpushed}
              fallback={
                <>
                  <span
                    class="icon-[lucide--chevron-right] size-2 shrink-0 git-commit-caret text-muted-foreground [.git-commit.expanded_&]:rotate-90"
                    aria-hidden="true"
                  />
                  <span
                    class="icon-[lucide--git-commit-vertical] size-3 shrink-0 git-commit-icon text-primary"
                    aria-hidden="true"
                  />
                </>
              }
            >
              <span class="up-ar size-2 shrink-0 border-r border-t border-muted-foreground rotate-45 [.up-commit.open_&]:rotate-[135deg]" />
            </Show>
            <span
              class={
                props.unpushed
                  ? 'up-subject min-w-0 flex-1 truncate'
                  : 'git-commit-msg-text min-w-0 flex-1 truncate'
              }
            >
              {props.commit.subject || '(no message)'}
            </span>
            <Show
              when={props.unpushed}
              fallback={
                <button
                  type="button"
                  tabindex="-1"
                  title="Copy SHA"
                  class="btn h-5 px-1 font-mono text-muted-foreground"
                  data-control="git-commit-sha"
                  data-variant="ghost"
                  data-size="xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyText(sha());
                  }}
                >
                  {props.commit.hash}
                </button>
              }
            >
              <span class="up-sha shrink-0 font-mono text-xs text-muted-foreground">
                {props.commit.short || props.commit.hash?.slice(0, 7)}
              </span>
            </Show>
          </div>
        )}
      </CommitDetails>
      <Show when={expanded()}>
        <CommitFiles
          sha={sha()}
          unpushed={props.unpushed}
          author={props.commit.author}
          date={props.commit.date}
        />
      </Show>
    </div>
  );
}
