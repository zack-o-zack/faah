import { onCleanup, onMount, Show, type Component } from 'solid-js';
import { useSettings } from './context.ts';

export const SettingsToolbar: Component = () => {
  const settings = useSettings();
  const dialog = () => settings.state.dialog;
  let search: HTMLInputElement | undefined;
  onMount(() => {
    const timer = setTimeout(() => {
      if (dialog().mode === 'ui' && !dialog().focus && search?.isConnected) search.focus();
    }, 50);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <header class="flex-row! items-center gap-4 shrink-0">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id="settings-title">Settings</h2>
        <button
          type="button"
          id="settings-path"
          class="self-start truncate font-mono text-xs text-muted-foreground hover:text-foreground"
          title={'Click to copy path: ' + settings.state.path}
          onClick={() => void settings.actions.copySettingsPath()}
        >
          {settings.state.path}
        </button>
      </div>
      <Show when={dialog().mode === 'ui'}>
        <div id="settings-search-bar" data-ui="settings-search-bar" class="relative w-72">
          <span
            class="icon-[lucide--search] size-3.5 shrink-0 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
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
            class="input w-full pl-8 pr-8"
            value={dialog().query}
            onInput={(event) => settings.actions.setSettingsQuery(event.currentTarget.value)}
          />
          <button
            id="settings-search-clear"
            type="button"
            title="Clear search"
            aria-label="Clear search"
            class="btn absolute right-1 top-1/2 -translate-y-1/2"
            data-control="icon-action"
            data-variant="ghost"
            data-size="icon-xs"
            onClick={() => {
              settings.actions.setSettingsQuery('');
              search?.focus();
            }}
          >
            <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </Show>
      <div class="button-group" role="group" aria-label="Settings view">
        <button
          type="button"
          id="settings-mode-ui"
          title="Settings UI"
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
      <button
        id="settings-close"
        type="button"
        title="Close (Esc)"
        aria-label="Close settings"
        class="btn"
        data-control="mini settings-close-btn"
        data-variant="ghost"
        data-size="icon-sm"
        onClick={settings.actions.closeSettings}
      >
        <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
      </button>
    </header>
  );
};
