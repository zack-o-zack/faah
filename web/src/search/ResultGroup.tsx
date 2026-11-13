import type { SearchMatch } from './decode.ts';
import type { FileMatches } from './decode.ts';

interface ResultGroupProps {
  file: FileMatches;
  query: string;
}
import type { JSX } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { displayPath } from './logic.ts';
export function ResultGroup(props: ResultGroupProps): JSX.Element {
  const editor = useEditor();
  const [collapsed, setCollapsed] = createSignal(false);
  async function open(match: SearchMatch) {
    await editor.actions.openFile(props.file.path, { line: match.line });
    editor.actions.flashFind?.(match.mid || props.query);
  }
  return (
    <>
      <div
        role="button"
        tabindex="0"
        class="flex items-center gap-2 p-2 cursor-pointer hover:bg-accent select-none [&.closed_[data-ui~=ar]]:-rotate-90"
        classList={{ closed: collapsed() }}
        data-ui="rfile"
        data-toggle={props.file.path}
        aria-expanded={!collapsed()}
        title={props.file.path}
        onClick={() => setCollapsed(!collapsed())}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setCollapsed(!collapsed());
          }
        }}
      >
        <span
          data-ui="ar"
          class="icon-[lucide--chevron-down] size-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <Show when={props.file.ext}>
          <span data-ui="ext" class="badge">
            {props.file.ext}
          </span>
        </Show>
        <span data-ui="fp" class="truncate min-w-0">
          {displayPath(props.file.path)}
        </span>
        <span data-ui="cnt" class="badge ml-auto">
          {props.file.matches.length}
        </span>
      </div>
      <Show when={!collapsed()}>
        <div data-group={props.file.path}>
          <For each={props.file.matches}>
            {(match) => (
              <div
                role="button"
                tabindex="0"
                class="flex min-w-0 items-center gap-2 p-2 cursor-pointer font-mono hover:bg-accent [&.sel]:bg-accent [&_mark]:bg-mark [&_mark]:text-inherit"
                data-ui="rline"
                data-p={props.file.path}
                data-n={match.line}
                title={`Jump to ${props.file.path}:${match.line}`}
                onClick={() => void open(match)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void open(match);
                }}
              >
                <span data-ui="rn" class="w-12 shrink-0 text-right text-muted-foreground">
                  {match.line}
                </span>
                <span data-ui="rt" class="flex-1 truncate text-muted-foreground">
                  {match.pre}
                  <mark>{match.mid || props.query}</mark>
                  {match.post}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
