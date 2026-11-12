import { createMemo, createSignal, onMount } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { fieldKind, openLabel } from './logic.js';
import { PathInput } from './PathInput.jsx';
import { createShortcut } from '../lib/shortcuts.jsx';

export function OpenWorkspaceForm() {
  const { actions } = useWorkbench();
  const [target, setTarget] = createSignal('');
  const kind = createMemo(() => fieldKind(target()));
  const label = () => openLabel(kind());
  let focusInput;
  createShortcut('/', () => focusInput?.());
  onMount(() => {
    const open = new URLSearchParams(location.search).get('open');
    if (open) {
      history.replaceState(null, '', location.pathname);
      setTarget(open);
      void actions.open(open);
    }
  });
  return (
    <form
      class="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        actions.cancelClone();
        if (['dir', 'pr'].includes(kind())) actions.open(target().trim());
      }}
    >
      <PathInput
        value={target()}
        onInput={(value) => {
          setTarget(value);
          actions.clearError();
        }}
        onFolder={actions.browse}
        autofocus
        onReady={(focus) => {
          focusInput = focus;
        }}
        label="Folder path or pull request URL"
        placeholder="Folder path or pull request URL"
      />
      <button class="btn" data-variant="primary" disabled={!['pr', 'dir'].includes(kind())}>
        {label()}
      </button>
    </form>
  );
}
