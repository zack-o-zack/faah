import { For, Index } from 'solid-js';
import { useEditor } from './context.jsx';
import { Dialog } from '../lib/Dialog.jsx';
import { Kbd } from '../lib/shortcuts.jsx';
import { VIM_SHORTCUT_SECTIONS } from './vim-help.js';
export function VimHelp() {
  const editor = useEditor();
  return (
    <Dialog open={true} title="Vim Keybindings" onClose={editor.actions.hideVimHelp}>
      <label class="label flex items-center gap-2">
        <input
          type="checkbox"
          class="input"
          checked={editor.ui.vimEnabled}
          onChange={(event) => editor.actions.setVimEnabled(event.currentTarget.checked)}
        />
        Enable Vim navigation
      </label>
      <For each={VIM_SHORTCUT_SECTIONS}>
        {(section) => (
          <section>
            <h3>{section.title}</h3>
            <dl>
              <For each={section.items}>
                {(item) => (
                  <>
                    <dt>
                      <Index each={item[0]}>{(combo) => <Kbd combo={combo()} />}</Index>
                    </dt>
                    <dd>{item[1]}</dd>
                  </>
                )}
              </For>
            </dl>
          </section>
        )}
      </For>
      <button
        class="btn"
        onClick={() => {
          editor.actions.hideVimHelp();
          editor.services.showHelp?.();
        }}
      >
        View Standard Shortcuts
      </button>
    </Dialog>
  );
}
