import { For, Show, type Component } from 'solid-js';
import { keyCaps } from '../lib/keyboard.ts';

interface Hint {
  combo?: string;
  /** Shown instead of key caps for a gesture with no keys. */
  label?: string;
  text: string;
}
const HINTS: Hint[] = [
  { combo: 'Mod+K', text: 'quick search / palette' },
  { combo: 'Mod+P', text: 'go to file' },
  { combo: 'Mod+Shift+F', text: 'search everywhere' },
  { combo: 'Mod+Shift+O', text: 'go to symbol' },
  { combo: 'Mod+F', text: 'find in file' },
  { combo: 'Mod+G', text: 'go to line' },
  { combo: 'F12', text: 'go to definition' },
  { combo: 'Shift+F12', text: 'find all references' },
  { label: 'hover', text: 'type and docs' },
  { combo: 'Mod+,', text: 'settings' },
  { combo: '?', text: 'all shortcuts' },
];

interface WelcomeProps {
  hidden: boolean;
  version: string;
}

/** What the editor shows with no file open: the logo, the version and the main shortcuts. */
export const Welcome: Component<WelcomeProps> = (props) => (
  <div
    id="empty"
    class="absolute inset-0 grid place-items-center bg-background"
    hidden={props.hidden}
  >
    <div class="empty text-muted-foreground">
      <div class="mb-6 flex items-end justify-center gap-2">
        <img
          class="hidden dark:block"
          src="static/logo-dark.svg"
          alt="faah"
          width="160"
          height="60"
        />
        <img
          class="block dark:hidden"
          src="static/logo-light.svg"
          alt="faah"
          width="160"
          height="60"
        />
        <span id="empty-ver" class="font-mono text-xs text-primary-text">
          <Show when={props.version}>v{props.version}</Show>
        </span>
      </div>
      <dl class="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-2 text-sm [&_dd]:text-left [&_dd]:text-muted-foreground [&_dt]:flex [&_dt]:justify-end [&_dt]:gap-1">
        <For each={HINTS}>
          {(hint) => (
            <>
              <dt>
                {hint.combo ? (
                  <For each={keyCaps(hint.combo)}>{(key) => <kbd class="kbd">{key}</kbd>}</For>
                ) : (
                  hint.label
                )}
              </dt>
              <dd>{hint.text}</dd>
            </>
          )}
        </For>
      </dl>
    </div>
  </div>
);
