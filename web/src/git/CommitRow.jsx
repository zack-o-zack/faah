import { createSignal, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
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
    <div class="git-commit" data-sha={sha()} classList={{ expanded: expanded() }}>
      <div class="flex items-center gap-1">
        <button
          class="git-commit-row btn min-w-0 flex-1 justify-start text-xs"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
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
          <span class="min-w-0 flex-1 truncate">{props.commit.subject || '(no message)'}</span>
          <span class="font-mono text-muted-foreground">
            {props.commit.short || props.commit.hash?.slice(0, 7)}
          </span>
        </button>
        <CommitDetails sha={sha()} />
      </div>
      <Show when={expanded()}>
        <p class="px-2 text-xs text-muted-foreground">
          {props.commit.author} · {props.commit.date}
        </p>
        <CommitFiles sha={sha()} />
      </Show>
    </div>
  );
}
