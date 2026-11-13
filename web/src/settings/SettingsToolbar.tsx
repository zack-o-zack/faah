import { onMount, Show, type Component } from 'solid-js';
import { useSettings } from './context.ts';

export const SettingsToolbar: Component = () => {
  const settings = useSettings();
  const dialog = () => settings.state.dialog;
  let search: HTMLInputElement | undefined;
  // Opening on a category or a setting puts focus there instead.
  onMount(() => {
    if (dialog().mode === 'ui' && !dialog().focus) search?.focus();
  });
  return (
    <div class="flex flex-wrap items-center gap-3 pb-3">
      <button
        type="button"
        id="settings-path"
        class="min-w-0 truncate font-mono text-xs text-muted-foreground hover:text-foreground"
        title={'Click to copy path: ' + settings.state.path}
        onClick={() => void settings.actions.copySettingsPath()}
      >
        {settings.state.path}
      </button>
      <span class="flex-1" />
      <Show when={dialog().mode === 'ui'}>
        <div class="relative w-72">
          <span
            class="icon-[lucide--search] pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={search}
            type="search"
            id="settings-search"
            aria-label="Search settings"
            placeholder="Search settings"
            autocomplete="off"
            spellcheck={false}
            class="input w-full pl-8"
            value={dialog().query}
            onInput={(event) => settings.actions.setSettingsQuery(event.currentTarget.value)}
          />
        </div>
      </Show>
      <div class="button-group" role="group" aria-label="Settings view">
        <button
          type="button"
          id="settings-mode-ui"
          class="btn"
          data-size="sm"
          aria-pressed={dialog().mode === 'ui'}
          data-variant={dialog().mode === 'ui' ? 'secondary' : 'outline'}
          onClick={() => settings.actions.setSettingsMode('ui')}
        >
          UI
        </button>
        <button
          type="button"
          id="settings-mode-json"
          title="Edit settings.json"
          class="btn"
          data-size="sm"
          aria-pressed={dialog().mode === 'json'}
          data-variant={dialog().mode === 'json' ? 'secondary' : 'outline'}
          onClick={() => settings.actions.setSettingsMode('json')}
        >
          JSON
        </button>
      </div>
    </div>
  );
};
