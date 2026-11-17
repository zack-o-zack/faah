/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Icon buttons implement the requested radiogroup keyboard pattern. */
import { For, type JSX } from 'solid-js';

const choices = [
  { id: '', name: 'System', icon: 'icon-[ph--monitor]' },
  { id: 'light', name: 'Light', icon: 'icon-[ph--sun]' },
  { id: 'dark', name: 'Dark', icon: 'icon-[ph--moon]' },
];

export function ThemeSwitch(props: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div id={props.id} class="theme-switch" role="radiogroup" aria-label="Theme">
      <For each={choices}>
        {(choice, index) => (
          <button
            role="radio"
            type="button"
            class="btn"
            data-variant="ghost"
            aria-label={choice.name}
            title={choice.name}
            aria-checked={props.value === choice.id}
            tabIndex={
              props.value === choice.id ||
              (!choices.some((item) => item.id === props.value) && index() === 0)
                ? 0
                : -1
            }
            onClick={() => props.onChange(choice.id)}
            onKeyDown={(event) => {
              let next: number;
              switch (event.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                  next = (index() + 1) % choices.length;
                  break;
                case 'ArrowLeft':
                case 'ArrowUp':
                  next = (index() + choices.length - 1) % choices.length;
                  break;
                case 'Home':
                  next = 0;
                  break;
                case 'End':
                  next = choices.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              const choice = choices[next];
              if (!choice) return;
              props.onChange(choice.id);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                [next]?.focus();
            }}
          >
            <span class={choice.icon} aria-hidden="true" />
          </button>
        )}
      </For>
    </div>
  );
}
