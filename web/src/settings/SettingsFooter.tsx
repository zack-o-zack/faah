import { createEffect, createSignal, onCleanup, type Component } from 'solid-js';
import { withKeys } from '../lib/keyboard.ts';
import { useSettings } from './context.ts';
import type { SaveStatus } from './store.ts';

const STATUS_ICONS: Record<SaveStatus['status'], string> = {
  saved: 'icon-[lucide--check]',
  unsaved: 'icon-[lucide--circle-dot]',
  saving: 'icon-[lucide--loader-circle] animate-spin',
  error: 'icon-[lucide--circle-alert]',
};
const STATUS_COLORS: Record<SaveStatus['status'], string> = {
  saved: 'text-gi',
  unsaved: 'text-warn',
  saving: 'text-primary-text',
  error: 'text-destructive',
};

function statusText(save: SaveStatus): string {
  switch (save.status) {
    case 'unsaved':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving changes...';
    default:
      return save.message;
  }
}

export const SettingsFooter: Component = () => {
  const settings = useSettings();
  const save = () => settings.state.save;
  const [savedFlash, setSavedFlash] = createSignal(false);
  createEffect(() => {
    setSavedFlash(save().status === 'saved');
    const timer = setTimeout(() => setSavedFlash(false), 2000);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <>
      <div
        id="settings-footer-status"
        role="status"
        data-ui="settings-footer-status"
        class={`flex items-center gap-2 ${STATUS_COLORS[save().status]}`}
      >
        <span class={`${STATUS_ICONS[save().status]} size-3.5 shrink-0`} aria-hidden="true" />
        <span id="settings-status-text">{statusText(save())}</span>
      </div>
      <button
        type="button"
        id="btn-settings-save"
        title={withKeys('Save settings ({Mod+S})')}
        class="btn"
        data-variant="primary"
        data-size="xs"
        disabled={save().status === 'saving' || save().status === 'saved'}
        onClick={() => void settings.actions.saveSettings()}
        data-control="settings-btn-save"
      >
        <span
          class={`${savedFlash() ? 'icon-[lucide--check]' : 'icon-[lucide--save]'} size-3.5 shrink-0 settings-btn-save-icon`}
          aria-hidden="true"
        />
        <span id="settings-btn-save-label">
          {savedFlash()
            ? 'Saved'
            : { error: 'Retry Save', saved: 'Save', saving: 'Saving...', unsaved: 'Save' }[
                save().status
              ]}
        </span>
      </button>
    </>
  );
};
