import type { JSX } from 'solid-js';
import { createMemo, createSignal, onMount } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { fieldKind, openLabel } from './logic.ts';
import { PathInput } from './PathInput.tsx';
import { createShortcut } from '../lib/shortcuts.tsx';

export function OpenWorkspaceForm(): JSX.Element {
  const { actions } = useWorkbench();
  const [target, setTarget] = createSignal('');
  const kind = createMemo(() => fieldKind(target()));
  const label = () => openLabel(kind());
  let focusInput: (() => void) | undefined;
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
      id="wb-open"
      class="dropdown-menu relative block shrink-0"
      autocomplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        actions.cancelClone();
        if (['dir', 'pr'].includes(kind())) actions.open(target().trim());
      }}
    >
      <PathInput
        group
        leading={
          <span data-align="inline-start">
            <span id="wb-kind" class="icon-[lucide--search] size-4" aria-hidden="true" />
          </span>
        }
        trailing={
          <button
            id="wb-go"
            type="submit"
            data-align="inline-end"
            class="btn me-1.5! gap-2 pe-1.5"
            data-variant="primary"
            data-size="sm"
            aria-label={label()}
            disabled={!['pr', 'dir'].includes(kind())}
          >
            <span id="wb-go-label" class="max-sm:hidden">
              {label()}
            </span>
            <kbd
              class="kbd h-5 min-w-5 bg-primary-foreground/15 px-1 text-current"
              aria-hidden="true"
            >
              <span class="icon-[lucide--corner-down-left] size-3" />
            </kbd>
          </button>
        }
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
    </form>
  );
}
