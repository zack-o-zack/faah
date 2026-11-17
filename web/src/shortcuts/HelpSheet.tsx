import type { Component, JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { VIM_SHORTCUT_SECTIONS } from '../editor/vim-help.ts';
import { handleTabKeys } from '../lib/tab-keys.ts';
import { Dialog } from '../lib/Dialog.tsx';
import { Kbd } from '../lib/shortcuts.tsx';
import { STANDARD_SHEET_SECTIONS } from './help-entries.ts';
import type { HelpTab } from './registry.ts';

export const HelpSheet: Component = () => {
  const editor = useEditor();
  const shortcuts = editor.shortcuts;
  const version = () => editor.store.state.workspace.meta?.version;
  const vim = () => editor.settings.preferences().vim;
  const sections = () =>
    shortcuts.helpTab() === 'vim' ? VIM_SHORTCUT_SECTIONS : STANDARD_SHEET_SECTIONS;
  return (
    <Show when={shortcuts.helpOpen()}>
      <Dialog
        open
        bare
        id="helpsheet"
        title="Keyboard shortcuts"
        onClose={shortcuts.actions.hideHelp}
      >
        <div class="compact-keycaps flex max-h-[85dvh] w-full max-w-[680px] flex-col gap-0 overflow-hidden p-0 text-13">
          <header class="flex-row! items-center gap-2.5 px-4 pt-3.5 pb-2.5">
            <h2 class="text-16">Keyboard shortcuts</h2>
            <Show when={version()}>
              <span data-ui="help-version" class="font-mono text-12 text-muted-foreground">
                v{version()}
              </span>
            </Show>
            <span class="flex-1" />
            <button
              type="button"
              class="btn"
              data-variant="ghost"
              data-size="icon-xs"
              aria-label="Close (Esc)"
              title="Close (Esc)"
              onClick={shortcuts.actions.hideHelp}
            >
              <span class="icon-[ph--x]" aria-hidden="true" />
            </button>
          </header>
          <div class="flex items-center gap-2 border-b pr-4 pl-4">
            <div class="tabs min-w-0 overflow-x-auto">
              <nav
                role="tablist"
                aria-orientation="horizontal"
                aria-label="Shortcut set"
                data-variant="line"
                class="h-9 items-stretch gap-4.5 rounded-none bg-transparent p-0 [&>[role=tab]]:flex-none"
                onKeyDown={handleTabKeys}
              >
                <HelpTabButton id="standard" name="Standard" />
                <HelpTabButton id="vim" name="Vim" />
              </nav>
            </div>
            <span class="flex-1" />
            <Show when={shortcuts.helpTab() === 'vim'}>
              <label class="flex items-center gap-2 text-12-5 text-muted-foreground">
                <input
                  type="checkbox"
                  role="switch"
                  class="input"
                  aria-label="Vim navigation"
                  aria-checked={vim()}
                  checked={vim()}
                  onChange={(event) => editor.actions.setVimEnabled(event.currentTarget.checked)}
                />
                Vim navigation
              </label>
            </Show>
          </div>
          <div
            id="help-sheet-panel"
            role="tabpanel"
            aria-labelledby={'btn-help-tab-' + shortcuts.helpTab()}
            class="grid min-h-0 flex-1 grid-cols-2 gap-x-7 gap-y-1.5 overflow-y-auto px-4 pt-3.5 pb-4.5 max-sm:grid-cols-1"
          >
            <For each={sections()}>
              {(section) => (
                <section>
                  <h3 class="mt-1.5 mb-1.5 text-11-5 font-medium text-muted-foreground">
                    {section.title}
                  </h3>
                  <dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
                    <For each={section.items}>
                      {(item) => (
                        <>
                          <dt class="flex justify-end gap-1">
                            <For each={item[0]}>{(combo) => <Kbd combo={combo} chord />}</For>
                          </dt>
                          <dd class="text-foreground">{item[1]}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </section>
              )}
            </For>
          </div>
        </div>
      </Dialog>
    </Show>
  );
};

function HelpTabButton(props: { id: HelpTab; name: string }): JSX.Element {
  const shortcuts = useEditor().shortcuts;
  const selected = () => shortcuts.helpTab() === props.id;
  return (
    <button
      id={'btn-help-tab-' + props.id}
      type="button"
      role="tab"
      tabindex={selected() ? 0 : -1}
      aria-selected={selected()}
      aria-controls="help-sheet-panel"
      class="px-0 py-0 text-12-5! text-muted-foreground aria-selected:text-foreground after:-bottom-px"
      onClick={() => shortcuts.setHelpTab(props.id)}
    >
      {props.name}
    </button>
  );
}
