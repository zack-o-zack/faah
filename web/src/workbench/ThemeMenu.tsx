import type { JSX } from 'solid-js';
import { createSignal, For } from 'solid-js';
import { DropdownMenu } from '../lib/DropdownMenu.tsx';
import { useTheme } from '../lib/theme-context.tsx';

export function ThemeMenu(): JSX.Element {
  const theme = useTheme();
  const [before, setBefore] = createSignal<string | null>(null);
  return (
    <DropdownMenu
      triggerId="btn-theme"
      accessibleLabel="Select theme"
      size="icon-xs"
      label={<span class="icon-[lucide--palette] size-3.5 shrink-0" aria-hidden="true" />}
      onOpen={() => setBefore(theme.preference())}
      onClose={(reason) => {
        if (reason !== 'select' && before()) theme.setTheme(before() || '', false);
        setBefore(null);
      }}
    >
      <For each={[{ id: 'system', name: 'System' }, ...theme.themes()]}>
        {(item) => (
          <button
            class="btn w-full"
            role="menuitemradio"
            aria-checked={theme.current() === item.id}
            onFocus={() => {
              if (!before()) setBefore(theme.preference());
              theme.setTheme(item.id, false);
            }}
            onMouseEnter={() => {
              if (!before()) setBefore(theme.preference());
              theme.setTheme(item.id, false);
            }}
            onClick={() => {
              theme.setTheme(item.id);
              setBefore(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && before()) {
                theme.setTheme(before() || '', false);
                setBefore(null);
              }
            }}
          >
            {item.name}
          </button>
        )}
      </For>
    </DropdownMenu>
  );
}
