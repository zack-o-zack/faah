import { Show, type Component } from 'solid-js';
import { Dialog } from '../lib/Dialog.jsx';
import { withKeys } from '../lib/keyboard.js';
import { useSettings } from './context.ts';
import { SettingsNav } from './SettingsNav.tsx';
import { SettingsList } from './SettingsList.tsx';
import { SettingsJson } from './SettingsJson.tsx';
import { SettingsFooter } from './SettingsFooter.tsx';
import { SettingsToolbar } from './SettingsToolbar.tsx';

interface SettingsDialogProps {
  onVimHelp: () => void;
}

/** Settings as a form over the schema, or the raw settings.json. */
export const SettingsDialog: Component<SettingsDialogProps> = (props) => {
  const settings = useSettings();
  const dialog = () => settings.state.dialog;
  return (
    <Show when={dialog().open}>
      <Dialog
        open={true}
        title="Settings"
        class="h-[min(840px,92vh)] gap-0 overflow-hidden sm:max-w-[1180px]"
        onClose={settings.actions.closeSettings}
        footer={<SettingsFooter />}
      >
        <div
          class="flex min-h-0 flex-1 flex-col"
          onKeyDown={(event) => {
            if (event.key.toLowerCase() !== 's' || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            void settings.actions.saveSettings();
          }}
          title={withKeys('Save with {Mod+S}')}
        >
          <SettingsToolbar />
          <Show when={dialog().mode === 'ui'} fallback={<SettingsJson />}>
            <div class="flex min-h-0 flex-1 overflow-hidden border-t">
              <SettingsNav />
              <SettingsList onVimHelp={props.onVimHelp} />
            </div>
          </Show>
        </div>
      </Dialog>
    </Show>
  );
};
