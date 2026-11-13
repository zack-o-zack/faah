import { withKeys } from '../lib/keyboard.js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { AgentSessions } from '../agents/AgentSessions.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.jsx';
import { ThreadList } from './ThreadList.jsx';
import { ThreadDetail } from './ThreadDetail.jsx';
export function ThreadsPanel() {
  const editor = useEditor();
  return (
    <aside
      id="threads-side"
      hidden={!editor.store.state.layout.threads}
      style={{ width: editor.store.state.layout.threadsWidth + 'px' }}
      class="flex shrink-0 flex-col overflow-hidden border-l bg-sidebar"
    >
      <header class="flex items-center justify-between border-b p-2">
        <strong>Threads</strong>
        <button
          id="btn-close-threads"
          class="btn"
          aria-label="Close threads"
          onClick={editor.actions.hideThreads}
        >
          ×
        </button>
      </header>
      <AgentSessions />
      <ErrorNotice error={editor.threads.state.error || editor.agents.state.error} />
      <Show
        when={
          editor.threads.state.current ||
          editor.threads.state.draft ||
          editor.threads.state.pending === 'explain'
        }
        fallback={<ThreadList />}
      >
        <ThreadDetail />
      </Show>
    </aside>
  );
}
export function ThreadsToggle() {
  const editor = useEditor();
  const shown = () => editor.store.state.layout.threads;
  const waiting = () => editor.agents.state.sessions.length;
  return (
    <button
      id="btn-top-threads"
      title={withKeys('Agent Threads ({Alt+T})')}
      class="btn"
      data-control="header-action btn-top-threads"
      data-variant={shown() ? 'secondary' : 'special'}
      data-size="xs"
      aria-pressed={shown()}
      hidden={editor.store.state.workspace.meta?.threadsEnabled === false}
      onClick={editor.actions.toggleThreads}
    >
      <span class="icon-[lucide--message-square] size-3 shrink-0" aria-hidden="true" />
      <span>Threads</span>
      <span
        class="badge"
        data-variant="secondary"
        data-control="thr-tab-count"
        title={`${waiting()} ${waiting() === 1 ? 'comment' : 'comments'} waiting to be applied`}
        hidden={!waiting()}
      >
        {waiting()}
      </span>
      <span
        data-ui="thr-tab-dot"
        class="inline-block"
        hidden={!editor.threads.state.list.some((thread) => thread.running)}
      />
    </button>
  );
}
