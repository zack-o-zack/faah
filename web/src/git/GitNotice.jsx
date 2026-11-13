import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { AgentChoice } from './AgentChoice.jsx';
export function GitNotice() {
  const editor = useEditor();
  const labels = {
    rebase: 'Rebase',
    merge: 'Merge',
    finish: 'Finish',
    abort: 'Abort',
    force: 'Force-push',
    push: 'Push',
    dismiss: 'Not now',
    cancel: 'Cancel',
  };
  function choose(choice) {
    const notice = editor.git.state.notice;
    if (choice === 'rebase' || choice === 'merge') return editor.actions.startSync(choice);
    if (choice === 'finish') return editor.actions.startSync(notice.sync.inProgress);
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
              aria-label="Dismiss"
              disabled={!!editor.git.state.pending}
              onClick={editor.actions.clearGitNotice}
            >
              ×
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
                  disabled={!!editor.git.state.pending && choice !== 'cancel'}
                  onClick={() => void choose(choice)}
                >
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
