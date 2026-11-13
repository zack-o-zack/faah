import { For, Show, type Component } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Dialog } from '../lib/Dialog.tsx';
import { keyCaps } from '../lib/keyboard.ts';
import type { ShortcutRegistry } from './registry.ts';
interface HelpEditor {
  shortcuts: ShortcutRegistry;
  store: { state: { workspace: { meta: { version?: string } | null } } };
  actions: { showVimHelp: () => void };
}
const ENTRIES: [string[], string][] = [
  [['Mod+,'], 'Open settings'],
  [['Mod+K'], 'Quick search / palette'],
  [['Mod+P'], 'Go to file'],
  [['Mod+Shift+P'], 'Command palette'],
  [['Mod+Shift+O'], 'Go to symbol'],
  [['Mod+Shift+F'], 'Search in files'],
  [['Mod+Shift+R'], 'Refresh workspace'],
  [['Mod+F'], 'Find in file'],
  [['Mod+E'], 'Toggle edit mode'],
  [['Mod+S'], 'Save file (in edit mode)'],
  [['Mod+G'], 'Go to line'],
  [['Mod+D'], 'Toggle diff view (git)'],
  [['Alt+Z'], 'Toggle word wrap'],
  [['[c', ']c'], 'Previous / next diff hunk'],
  [['[f', ']f'], 'Previous / next changed file'],
  [['Alt+M'], 'Toggle Markdown / table preview'],
  [['Shift+F1'], 'Show symbol documentation'],
  [['Enter', 'Shift+Enter'], 'Next / previous match'],
  [['F12', 'Mod+Click'], 'Go to definition'],
  [['Shift+F12'], 'Find all references'],
  [['Alt+Shift+H'], 'Call trail (callers / callees)'],
  [['Mod+J'], 'Toggle right sidebar / inspector'],
  [['Alt+Left', 'Alt+Right'], 'Navigate back / forward'],
  [['Mod+B'], 'Toggle sidebar'],
  [['Alt+W'], 'Close tab'],
  [['Alt+Shift+T'], 'Reopen closed tab'],
  [['Ctrl+Tab'], 'Next tab'],
  [['Alt+1…9'], 'Select tab'],
  [['Double click'], 'Highlight all occurrences'],
  [['Mod+A'], 'Select whole file'],
  [['Mod+C'], 'Copy selection (source / formatted text)'],
  [['Alt+C', 'Alt+A'], 'Copy selection ref / with context'],
  [['Alt+U'], 'Find usages of selection'],
  [['Alt+E'], 'Edit selection inline'],
  [['Alt+T'], 'Start a thread on the selection'],
  [['Alt+X'], 'Explain the selection'],
  [['Right click'], 'Selection actions at the pointer'],
  [['Mod+Home|Mod+Up', 'Mod+End|Mod+Down'], 'Top / bottom of file'],
  [['Home|Mod+Left', 'End|Mod+Right'], 'Start / end of line'],
  [['Left', 'Right'], 'Move caret along the line'],
  [['Esc'], 'Dismiss'],
];
export const HelpSheet: Component = () => {
  const editor: HelpEditor = useEditor();
  const shortcuts = editor.shortcuts;
  const version = () => editor.store.state.workspace.meta?.version;
  return (
    <Show when={shortcuts.helpOpen()}>
      <Dialog
        open
        bare
        id="helpsheet"
        title="Keyboard Shortcuts"
        onClose={shortcuts.actions.hideHelp}
      >
        <div class="sm:max-w-4xl overflow-auto">
          <header class="flex-row! items-center gap-2">
            <h2>Keyboard Shortcuts</h2>
            <Show when={version()}>
              <span data-ui="help-version" class="p-3 font-mono text-primary-text">
                v{version()}
              </span>
            </Show>
            <div
              style={{
                'margin-left': 'auto',
                display: 'flex',
                gap: '12px',
                'align-items': 'center',
              }}
            >
              <button
                id="btn-switch-to-vim-help"
                style={{ 'font-size': '12px', cursor: 'pointer' }}
                title="View Vim Keybindings"
                class="btn"
                data-control="settings-btn-link"
                data-variant="link"
                data-size="xs"
                onClick={() => {
                  shortcuts.actions.hideHelp();
                  editor.actions.showVimHelp();
                }}
              >
                View Vim Keybindings
              </button>
            </div>
          </header>
          <dl
            data-ui="help-grid"
            class="grid grid-cols-[auto_1fr_auto_1fr] gap-3 items-center [&_dt]:flex [&_dt]:gap-1 [&_dt]:justify-end [&_dd]:text-muted-foreground"
          >
            <For each={ENTRIES}>
              {(entry) => (
                <>
                  <dt>
                    <For each={entry[0]}>
                      {(combo, index) => (
                        <>
                          <Show when={index() > 0}>
                            <span data-ui="key-or" class="text-muted-foreground">
                              /
                            </span>
                          </Show>
                          <For each={keyCaps(combo)}>{(key) => <kbd class="kbd">{key}</kbd>}</For>
                        </>
                      )}
                    </For>
                  </dt>
                  <dd>{entry[1]}</dd>
                </>
              )}
            </For>
          </dl>
        </div>
      </Dialog>
    </Show>
  );
};
