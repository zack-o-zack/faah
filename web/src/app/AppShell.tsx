import { Show, type Component } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { withKeys } from '../lib/keyboard.js';
import { Sidebar } from '../layout/Sidebar.jsx';
import { RightSidebar } from '../layout/RightSidebar.jsx';
import { PanelHandle } from '../layout/PanelHandle.jsx';
import { StatusBar } from '../status/StatusBar.jsx';
import { ThreadsPanel, ThreadsToggle } from '../threads/ThreadsPanel.jsx';
import { ReviewToggle } from '../review/ReviewToggle.jsx';
import { ReviewView } from '../review/ReviewView.jsx';
import { PRPanels } from '../pr/PRPanels.jsx';
import { TabStrip } from '../editor/TabStrip.jsx';
import { FileActions } from '../editor/FileActions.jsx';
import { Viewport } from '../editor/Viewport.jsx';
import { EditView } from '../editor/EditView.jsx';
import { FindBar } from '../editor/FindBar.jsx';
import { HoverCard } from '../editor/HoverCard.jsx';
import { Minimap } from '../editor/Minimap.jsx';
import { Viewers } from '../viewers/Viewers.jsx';
import { ExplainOrb } from '../viewers/ExplainOrb.jsx';
import { Welcome } from './Welcome.tsx';
import type { WorkspaceMeta } from './types.ts';

/** What the page layout reads from the editor store. */
interface ShellEditor {
  active: () => object | null;
  store: { state: { workspace: { meta: WorkspaceMeta | null }; layout: { right: boolean } } };
  review: { state: { mode: 'code' | 'review' } };
  actions: { togglePanel: (panel: 'right') => void };
}

// The bar stays draggable in the desktop app; its controls do not.
const TOP_BAR =
  'main-top-bar desktop:min-h-[var(--titlebar-h,2.5rem)] desktop:[-webkit-app-region:drag] desktop:[&_button]:[-webkit-app-region:no-drag] desktop:[&_a]:[-webkit-app-region:no-drag] desktop:[&_[role=group]]:[-webkit-app-region:no-drag] desktop:[&_[role=tab]]:[-webkit-app-region:no-drag] [body.side-hidden_&]:desktop:pl-[calc(0.5rem+var(--titlebar-left,0px))] desktop:pr-[calc(0.5rem+var(--titlebar-right,0px))] relative z-[7] flex shrink-0 items-center justify-between gap-2 border-b bg-sidebar px-2 py-1';

const TopBar: Component = () => {
  const editor: ShellEditor = useEditor();
  const meta = (): WorkspaceMeta | null => editor.store.state.workspace.meta;
  const inspector = (): boolean => editor.store.state.layout.right;
  return (
    <header id="main-top-bar" class={TOP_BAR}>
      {/* Desktop app on Windows and Linux only (desktop variants, desktop/preload.cjs) */}
      <button
        data-desktop-menu
        title="Menu"
        aria-label="Application menu"
        class="btn desktop-menu-btn hidden! win-linux:inline-flex!"
        data-control="header-action"
        data-variant="ghost"
        data-size="xs"
      >
        <span class="icon-[lucide--menu] size-3 shrink-0" aria-hidden="true" />
      </button>
      <ReviewToggle />
      <div class="main-top-bar-spacer flex-1" />
      {/* The project name, centred on the bar and sized to the name alone */}
      <div
        data-ui="top-title"
        class="absolute left-1/2 flex max-w-[min(24rem,40%)] min-w-0 -translate-x-1/2 items-center gap-1"
      >
        <Show when={meta()?.workbench}>
          {(href) => (
            <a
              class="btn"
              data-control="icon-action wb-back"
              data-variant="ghost"
              data-size="icon-xs"
              href={href()}
              title="Back to the faah workbench"
              aria-label="Back to the faah workbench"
            >
              <span class="icon-[lucide--layout-grid] size-3.5" aria-hidden="true" />
            </a>
          )}
        </Show>
        <span
          id="root-name"
          class="min-w-0 truncate text-xs font-medium text-muted-foreground"
          title={meta()?.root}
        >
          {meta()?.name}
        </span>
      </div>
      <div id="view-switches" class="flex items-center gap-1">
        <ThreadsToggle />
        <button
          id="btn-open-right"
          title={withKeys('Inspector (References, Symbols, Calls, Search) ({Mod+J})')}
          aria-label="Toggle inspector"
          aria-pressed={inspector()}
          class="btn"
          data-control="header-action open-right"
          data-variant={inspector() ? 'secondary' : 'ghost'}
          data-size="icon-xs"
          onClick={() => editor.actions.togglePanel('right')}
        >
          <span class="icon-[lucide--panel-right] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};

/** The page: file tree, editor column, inspector and threads, side by side. */
export const AppShell: Component = () => {
  const editor: ShellEditor = useEditor();
  return (
    <div id="app" class="flex h-dvh overflow-hidden">
      <Sidebar />
      <PanelHandle panel="left" label="Sidebar width" />
      <main id="main" class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <TabStrip>
          <FileActions />
        </TabStrip>
        <div
          id="editor"
          class="relative min-h-0 flex-1 overflow-hidden bg-background"
          hidden={editor.review.state.mode === 'review'}
        >
          <Viewport />
          <EditView />
          <FindBar />
          <HoverCard />
          <Viewers />
          <Minimap />
          <Welcome
            hidden={!!editor.active()}
            version={editor.store.state.workspace.meta?.version || ''}
          />
          {/* Top-right corner of the editor: the explanation orb */}
          <div
            data-ui="editor-corner"
            class="pointer-events-none absolute top-2 right-2 z-20 flex max-w-[calc(100%_-_16px)] flex-col items-end gap-2 *:pointer-events-auto"
          >
            <ExplainOrb />
          </div>
        </div>
        <ReviewView />
        <PRPanels />
        <StatusBar />
      </main>
      <PanelHandle panel="right" label="Inspector width" />
      <RightSidebar />
      <PanelHandle panel="threads" label="Threads width" />
      <ThreadsPanel />
    </div>
  );
};
