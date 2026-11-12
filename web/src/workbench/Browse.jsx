import { createSignal, Show } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { BrowseToolbar } from './BrowseToolbar.jsx';
import { NewFolderForm } from './NewFolderForm.jsx';
import { DirectoryList } from './DirectoryList.jsx';
import { Kbd } from '../lib/shortcuts.jsx';

export function Browse() {
  const { state, actions } = useWorkbench();
  const [mkdir, setMkdir] = createSignal(false);
  let list;
  const selected = () => state.directory.entries[state.selected];
  const useFolder = () => actions.useFolder(selected()?.path || state.directory.path);
  const keydown = (e) => {
    if (e.target.tagName === 'INPUT') return;
    const entries = state.directory.entries;
    if (['ArrowDown', 'ArrowUp'].includes(e.key) && !e.metaKey) {
      e.preventDefault();
      actions.selectDirectory(
        Math.max(
          0,
          Math.min(entries.length - 1, state.selected + (e.key === 'ArrowDown' ? 1 : -1)),
        ),
      );
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      useFolder();
    } else if (['Enter', 'ArrowRight'].includes(e.key) || (e.metaKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      if (selected()) actions.browse(selected().path);
    } else if (['Backspace', 'ArrowLeft'].includes(e.key) || (e.metaKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      if (state.directory.parent) actions.browse(state.directory.parent);
    } else if (e.key === 'Escape') actions.selectDirectory(-1);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const i = entries.findIndex((item) =>
        item.name.toLowerCase().startsWith(e.key.toLowerCase()),
      );
      if (i >= 0) actions.selectDirectory(i);
    }
  };
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <BrowseToolbar selected={selected()} onMkdir={() => setMkdir(true)} onOpen={useFolder} />
      <Show when={mkdir()}>
        <NewFolderForm
          onDone={() => {
            setMkdir(false);
            list.focus();
          }}
        />
      </Show>
      <DirectoryList
        listRef={(element) => {
          list = element;
        }}
        onKeyDown={keydown}
      />
      <p class="text-xs text-muted-foreground">
        Enter goes into a folder, Backspace goes up, <Kbd combo="Mod+Enter" /> opens it.
      </p>
    </div>
  );
}
