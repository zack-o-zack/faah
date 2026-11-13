import { Show, type Component } from 'solid-js';
import { Dialog } from '../lib/Dialog.tsx';
import { useSettings } from './context.ts';
import { SettingsNav } from './SettingsNav.tsx';
import { SettingsList } from './SettingsList.tsx';
import { SettingsJson } from './SettingsJson.tsx';
import { SettingsFooter } from './SettingsFooter.tsx';
import { SettingsToolbar } from './SettingsToolbar.tsx';

interface SettingsDialogProps {
  onVimHelp: () => void;
}

export const SettingsDialog: Component<SettingsDialogProps> = (props) => {
  const settings = useSettings();
  const dialog = () => settings.state.dialog;
  return (
    <Show when={dialog().open}>
      <Dialog
        open
        bare
        id="settings-modal"
        title="Settings"
        onClose={settings.actions.closeSettings}
      >
        <div
          class="sm:max-w-[1180px] h-[min(840px,92vh)] overflow-hidden gap-0"
          onKeyDown={(event) => {
            if (event.key.toLowerCase() !== 's' || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            void settings.actions.saveSettings();
          }}
        >
          <SettingsToolbar />
          <section class="-mx-6 flex min-h-0 flex-1 flex-col overflow-hidden border-y border-border">
            <Show when={dialog().mode === 'ui'} fallback={<SettingsJson />}>
              <div
                id="settings-ui-container"
                data-ui="settings-body"
                class="flex flex-1 min-h-0 overflow-hidden"
              >
                <SettingsNav />
                <SettingsList onVimHelp={props.onVimHelp} />
              </div>
            </Show>
          </section>
          <footer id="settings-footer" class="flex-row! items-center justify-between shrink-0">
            <SettingsFooter />
          </footer>
        </div>
      </Dialog>
    </Show>
  );
};
