import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { previewKind } from '../viewers/view.ts';
import { Kbd } from '../lib/shortcuts.jsx';

export function StatusActions() {
  const editor = useEditor();
  const actions = [
    {
      name: 'files',
      label: 'Files',
      keys: 'Mod+P',
      icon: 'zap',
      run: () => editor.actions.openPalette('file'),
    },
    {
      name: 'search',
      label: 'Search',
      keys: 'Mod+Shift+F',
      icon: 'search',
      run: () => editor.actions.showRightInspector('search'),
    },
    { name: 'find', label: 'Find in File', keys: 'Mod+F', run: () => editor.actions.openFind() },
    { name: 'goto', label: 'Go to', keys: 'Mod+G', run: () => editor.actions.openPalette('line') },
    {
      name: 'md-preview',
      label: 'Preview',
      keys: 'Alt+M',
      visible: () => previewKind(editor.active()) && !editor.active()?.isEditing,
      run: () => editor.actions.togglePreview(editor.active(), editor.active().cur),
    },
    { name: 'wrap', label: 'Wrap', keys: 'Alt+Z', run: () => editor.actions.toggleWrap() },
    {
      name: 'vim-help',
      label: 'Vim Keys',
      keys: '?',
      visible: () => editor.settings.preferences().vim,
      run: () => editor.actions.showVimHelp(),
    },
    { name: 'help', label: 'Help', keys: '?', run: () => editor.actions.showHelp() },
  ];
  return (
    <div id="footer-actions" class="flex items-center gap-1 [#status.selecting_&]:hidden">
      <For each={actions}>
        {(action) => (
          <Show when={!action.visible || action.visible()}>
            <button
              class={action.icon ? 'btn' : 'btn desktop:hidden!'}
              data-action={action.name}
              data-control="bar-action"
              data-variant="ghost"
              data-size="xs"
              onClick={action.run}
            >
              <Show when={action.icon}>
                <span
                  class={
                    action.icon === 'zap'
                      ? 'icon-[lucide--zap] size-3.5 shrink-0 shell-ico hidden desktop:block'
                      : 'icon-[lucide--search] size-3.5 shrink-0 shell-ico hidden desktop:block'
                  }
                  aria-hidden="true"
                />
              </Show>
              <span class="bar-action-label text-xs font-medium desktop:hidden">
                {action.name === 'md-preview' && previewKind(editor.active()) === 'table'
                  ? 'Table'
                  : action.label}
              </span>
              <Kbd
                combo={action.keys}
                class="kbd desktop:hidden has-[>kbd]:bg-transparent has-[>kbd]:p-0 has-[>kbd]:gap-1"
              />
            </button>
          </Show>
        )}
      </For>
    </div>
  );
}
