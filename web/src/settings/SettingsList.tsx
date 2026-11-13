import { For, Show, type Component } from 'solid-js';
import { useSettings } from './context.ts';
import { SettingCard } from './SettingCard.tsx';

interface SettingsListProps {
  onVimHelp: () => void;
}

export const SettingsList: Component<SettingsListProps> = (props) => {
  const settings = useSettings();
  const dialog = () => settings.state.dialog;
  return (
    <section
      id="settings-list"
      class="flex flex-1 min-w-0 flex-col overflow-y-auto px-6 py-2"
      aria-label="Settings list"
    >
      <Show when={settings.state.loadError}>
        <div role="alert" class="alert my-2 text-destructive">
          Could not load settings: {settings.state.loadError}
        </div>
      </Show>
      <For
        each={settings.visible()}
        fallback={
          <div class="empty p-3 text-center text-muted-foreground">
            No matching settings found for "{dialog().query.trim() || dialog().category}".
          </div>
        }
      >
        {(item) => <SettingCard item={item} onVimHelp={props.onVimHelp} />}
      </For>
    </section>
  );
};
