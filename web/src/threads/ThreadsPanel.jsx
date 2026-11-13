import { withKeys } from '../lib/keyboard.ts';
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
      class="flex w-96 shrink-0 flex-col overflow-hidden border-l bg-sidebar [body.threads-hidden_&]:hidden"
    >
      <header class="inspector-head desktop:min-h-[var(--titlebar-h,2.5rem)] desktop:[-webkit-app-region:drag] desktop:[&_button]:[-webkit-app-region:no-drag] desktop:[&_a]:[-webkit-app-region:no-drag] desktop:[&_[role=group]]:[-webkit-app-region:no-drag] desktop:[&_[role=tab]]:[-webkit-app-region:no-drag] flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 threads-head">
        <div class="threads-head-title flex items-center gap-2 font-medium [&_svg]:shrink-0 [&_svg]:text-primary">
          <span class="icon-[lucide--message-square] size-3.5 shrink-0" aria-hidden="true" />
          <span class="threads-head-label text-xs font-medium">Threads</span>
        </div>
        <div class="inspector-head-actions flex items-center">
          <button
            id="btn-close-threads"
            class="btn"
            aria-label="Close threads"
            onClick={editor.actions.hideThreads}
            data-variant="ghost"
            data-size="icon-xs"
            data-control="icon-action"
          >
            <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>
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
