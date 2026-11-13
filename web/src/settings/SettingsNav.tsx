import { For, type Component } from 'solid-js';
import { useSettings } from './context.ts';

export const SettingsNav: Component = () => {
  const settings = useSettings();
  const active = (category: string) =>
    !settings.state.dialog.query && settings.state.dialog.category === category;
  return (
    <nav
      id="settings-nav"
      class="flex w-52 max-w-1/3 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-3"
      aria-label="Settings categories"
    >
      <For each={settings.categories()}>
        {(category) => (
          <button
            type="button"
            class="btn w-full justify-start aria-pressed:text-primary-text"
            data-size="xs"
            aria-pressed={active(category)}
            data-variant={active(category) ? 'secondary' : 'ghost'}
            onClick={() => settings.actions.setSettingsCategory(category)}
          >
            {category}
          </button>
        )}
      </For>
    </nav>
  );
};
