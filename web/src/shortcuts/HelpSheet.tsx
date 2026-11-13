import { For, Show, type Component } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Dialog } from '../lib/Dialog.jsx';
import { keyCaps } from '../lib/keyboard.js';
import type { ShortcutRegistry } from './registry.ts';

interface HelpEditor {
  shortcuts: ShortcutRegistry;
  store: { state: { workspace: { meta: { version?: string } | null } } };
  actions: { showVimHelp: () => void };
}

const KeyCaps: Component<{ combo: string }> = (props) => {
  const caps = (): string[] => keyCaps(props.combo);
  return (
    <span class="inline-flex gap-1">
      <For each={caps()}>{(key) => <kbd class="kbd">{key}</kbd>}</For>
    </span>
  );
};

/** Every shortcut bound right now, grouped by what it acts on. */
export const HelpSheet: Component = () => {
  const editor: HelpEditor = useEditor();
  const shortcuts = editor.shortcuts;
  const version = () => editor.store.state.workspace.meta?.version;
  return (
    <Show when={shortcuts.helpOpen()}>
      <Dialog
        open={true}
        title="Keyboard Shortcuts"
        subtitle={version() ? 'v' + version() : ''}
        class="overflow-auto sm:max-w-4xl"
        onClose={shortcuts.actions.hideHelp}
        footer={
          <button
            type="button"
            class="btn"
            data-variant="link"
            data-size="xs"
            onClick={() => {
              shortcuts.actions.hideHelp();
              editor.actions.showVimHelp();
            }}
          >
            View Vim Keybindings
          </button>
        }
      >
        <div class="grid gap-6 sm:grid-cols-2">
          <For each={shortcuts.groups()}>
            {(group) => (
              <section class="flex flex-col gap-2" aria-label={group.section}>
                <h3 class="text-xs font-medium text-muted-foreground">{group.section}</h3>
                <dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
                  <For each={group.entries}>
                    {(entry) => (
                      <>
                        <dt class="flex justify-end gap-1">
                          <For each={entry.keys}>
                            {(combo, index) => (
                              <>
                                <Show when={index() > 0}>
                                  <span class="text-muted-foreground">/</span>
                                </Show>
                                <KeyCaps combo={combo} />
                              </>
                            )}
                          </For>
                        </dt>
                        <dd class="text-muted-foreground">{entry.label}</dd>
                      </>
                    )}
                  </For>
                </dl>
              </section>
            )}
          </For>
        </div>
      </Dialog>
    </Show>
  );
};
