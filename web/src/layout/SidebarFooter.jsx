import { useEditor } from '../editor/context.jsx';
import { useTheme } from '../lib/theme-context.tsx';
import { listThemes } from '../lib/theme.ts';
export function SidebarFooter() {
  const editor = useEditor();
  const theme = useTheme();
  function cycle() {
    const themes = listThemes();
    const index = themes.findIndex((item) => item.id === theme.current());
    theme.setTheme(themes[(index + 1) % themes.length].id);
  }
  return (
    <footer class="side-foot flex shrink-0 items-center justify-end gap-2 border-t px-2 py-1 desktop:hidden">
      <span class="side-actions flex shrink-0 items-center gap-1 desktop:hidden">
        <a
          class="btn"
          data-control="icon-action"
          data-variant="ghost"
          data-size="icon-xs"
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
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[lucide--circle-help] size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          id="btn-theme"
          class="btn"
          aria-label="Cycle theme"
          onClick={cycle}
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[lucide--palette] size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          id="btn-settings"
          class="btn"
          aria-label="Settings"
          onClick={() => editor.actions.openSettings('ui')}
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[lucide--settings] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </span>
    </footer>
  );
}
