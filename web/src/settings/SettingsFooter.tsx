import type { Component } from 'solid-js';
import { withKeys } from '../lib/keyboard.js';
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
  return (
    <>
      <div role="status" class={`flex flex-1 items-center gap-2 ${STATUS_COLORS[save().status]}`}>
        <span class={`${STATUS_ICONS[save().status]} size-3.5 shrink-0`} aria-hidden="true" />
        {statusText(save())}
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
      >
        <span class="icon-[lucide--save] size-3.5 shrink-0" aria-hidden="true" />
        {save().status === 'error' ? 'Retry Save' : 'Save'}
      </button>
    </>
  );
};
