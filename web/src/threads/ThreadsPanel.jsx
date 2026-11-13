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
  return (
    <button
      id="btn-top-threads"
      class="btn"
      aria-pressed={editor.store.state.layout.threads}
      onClick={editor.actions.toggleThreads}
    >
      Threads{' '}
      <Show when={editor.agents.state.sessions.length}>
        <span class="badge">{editor.agents.state.sessions.length}</span>
      </Show>
      <Show when={editor.threads.state.list.some((thread) => thread.running)}>
        <span aria-label="Agent running">◌</span>
      </Show>
    </button>
  );
}
