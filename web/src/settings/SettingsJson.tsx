import { onMount, Show, type Component } from 'solid-js';
import { useSettings } from './context.ts';

export const SettingsJson: Component = () => {
  const settings = useSettings();
  const dialog = () => settings.state.dialog;
  let editor: HTMLTextAreaElement | undefined;
  onMount(() => editor?.focus());
  return (
    <div
      id="settings-json-container"
      data-ui="settings-json-body"
      class="flex flex-1 min-h-0 flex-col overflow-hidden"
    >
      <div class="flex items-center justify-between gap-2 p-3 text-muted-foreground">
        <span>Edit settings.json directly. Changes apply immediately upon saving.</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            title="Discard unsaved changes"
            class="btn"
            data-variant="outline"
            data-size="xs"
            onClick={settings.actions.discardRawSettings}
          >
            Discard
          </button>
        </div>
      </div>
      <Show when={dialog().rawError}>
        <div role="alert" class="alert text-destructive">
          {dialog().rawError}
        </div>
      </Show>
      <Show when={dialog().rawNotice}>
        <div role="status" class="alert text-gi">
          {dialog().rawNotice}
        </div>
      </Show>
      <textarea
        ref={editor}
        aria-label="Settings JSON"
        spellcheck={false}
        autocomplete="off"
        wrap="off"
        class="textarea min-h-0 flex-1 resize-none font-mono"
        value={dialog().raw}
        onInput={(event) => settings.actions.setRawSettings(event.currentTarget.value)}
      />
    </div>
  );
};
