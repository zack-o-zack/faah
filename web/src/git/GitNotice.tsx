import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { AgentChoice } from './AgentChoice.tsx';
export function GitNotice(): JSX.Element {
  const editor = useEditor();
  const labels: Record<string, string> = {
    rebase: 'Rebase',
    merge: 'Merge',
    finish: 'Finish',
    abort: 'Abort',
    force: 'Force-push',
    push: 'Push',
    dismiss: 'Not now',
    cancel: 'Cancel',
  };
  function choose(choice: string) {
    const notice = editor.git.state.notice;
    if (choice === 'rebase' || choice === 'merge') return editor.actions.startSync(choice);
    if (choice === 'finish' && notice?.sync?.inProgress)
      return editor.actions.startSync(notice.sync.inProgress);
    if (choice === 'abort') return editor.actions.abortGitSync();
    if (choice === 'force') return editor.actions.pushGit(true);
    if (choice === 'push') return editor.actions.pushGit();
    if (choice === 'cancel') return editor.actions.cancelGitJob();
    editor.actions.clearGitNotice();
  }
  return (
    <Show when={editor.git.state.notice}>
      {(notice) => (
        <section
          id="git-notice"
          role="status"
          class="alert flex flex-col gap-2"
          data-tone={notice().tone}
        >
          <div class="flex justify-between">
            <strong id="git-notice-title">{notice().title}</strong>
            <button
              class="btn"
              id="git-notice-close"
              data-control="git-notice-close"
              data-variant="ghost"
              data-size="icon-xs"
              aria-label="Dismiss"
              disabled={!!editor.git.state.pending}
              onClick={editor.actions.clearGitNotice}
            >
              <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
          <p class="whitespace-pre-wrap">{notice().text}</p>
          <Show when={notice().sync}>
            <AgentChoice />
          </Show>
          <div class="flex flex-wrap gap-2">
            <For each={notice().choices}>
              {(choice) => (
                <button
                  class="btn"
                  data-variant={noticeVariant(choice)}
                  data-size="xs"
                  disabled={!!editor.git.state.pending && choice !== 'cancel'}
                  onClick={() => void choose(choice)}
                >
                  <Show when={['rebase', 'merge', 'finish'].includes(choice)}>
                    <span class="icon-[lucide--sparkle] size-3.5 shrink-0" aria-hidden="true" />
                  </Show>
                  {labels[choice]}
                </button>
              )}
            </For>
          </div>
          <Show when={notice().log}>
            <details>
              <summary>Agent output</summary>
              <pre class="max-h-40 overflow-auto whitespace-pre-wrap">{notice().log}</pre>
            </details>
          </Show>
        </section>
      )}
    </Show>
  );
}

function noticeVariant(choice: string): string {
  if (['rebase', 'merge', 'finish'].includes(choice)) return 'special';
  if (['force', 'push'].includes(choice)) return 'primary';
  return 'outline';
}
