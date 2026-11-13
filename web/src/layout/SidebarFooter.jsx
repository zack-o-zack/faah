import { useEditor } from '../editor/context.jsx';
import { useTheme } from '../lib/theme-context.jsx';
import { listThemes } from '../lib/theme.js';
export function SidebarFooter() {
  const editor = useEditor();
  const theme = useTheme();
  function cycle() {
    const themes = listThemes();
    const index = themes.findIndex((item) => item.id === theme.current());
    theme.setTheme(themes[(index + 1) % themes.length].id);
  }
  return (
    <footer class="flex shrink-0 justify-end gap-1 border-t p-1">
      <a
        class="btn"
        href="https://github.com/zack-o-zack/faah"
        target="_blank"
        rel="noopener"
        aria-label="faah on GitHub"
      >
        <span class="icon-[lucide--github] size-3.5" />
      </a>
      <button
        id="btn-help"
        class="btn"
        aria-label="Keyboard shortcuts"
        onClick={() => editor.actions.showHelp()}
      >
        Help
      </button>
      <button id="btn-theme" class="btn" aria-label="Cycle theme" onClick={cycle}>
        Theme
      </button>
      <button
        id="btn-settings"
        class="btn"
        aria-label="Settings"
        onClick={() => editor.actions.openSettings('ui')}
      >
        Settings
      </button>
    </footer>
  );
}
