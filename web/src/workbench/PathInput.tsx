import { decodeCompletion } from './decode.ts';

interface PathInputProps {
  autofocus?: boolean;
  value: string;
  group?: boolean;
  label?: string;
  placeholder?: string;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  onInput: (value: string) => void;
  onFolder?: (path: string) => void;
  onReady?: (focus: () => void) => void;
}
import type { JSX } from 'solid-js';
import { createResource, createSignal, createUniqueId, onMount, Show } from 'solid-js';
import { api } from '../lib/api.ts';
import { looksLikeURL } from './logic.ts';
import { PathSuggestions } from './PathSuggestions.tsx';
export function PathInput(props: PathInputProps): JSX.Element {
  const [focused, setFocused] = createSignal(false);
  const [selected, setSelected] = createSignal(-1);
  const id = createUniqueId();
  let input: HTMLInputElement | undefined;
  onMount(() => {
    if (props.autofocus) input?.focus();
    props.onReady?.(() => input?.focus());
  });
  const query = () =>
    focused() && props.value.trim() && !looksLikeURL(props.value) ? props.value : false;
  const [entries] = createResource(query, async (q) => {
    try {
      return decodeCompletion(await api('api/wb/complete', { q })).entries || [];
    } catch {
      return [];
    }
  });
  const suggestions = () => (query() ? entries() || [] : []);
  const accept = (index: number) => {
    const item = suggestions()[index];
    if (!item) return;
    props.onInput(item.path);
    props.onFolder?.(item.path);
    setSelected(-1);
    input?.focus();
  };
  return (
    <div class={props.group ? 'contents' : 'dropdown-menu relative flex-1'}>
      <div class={props.group ? 'input-group group/field h-10' : 'contents'}>
        {props.leading}
        <input
          ref={(el) => {
            input = el;
          }}
          class={props.group ? undefined : 'input w-full'}
          value={props.value}
          aria-label={props.label}
          placeholder={props.placeholder}
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={id}
          aria-expanded={!!suggestions().length}
          aria-activedescendant={selected() >= 0 ? `${id}-${selected()}` : undefined}
          onInput={(e) => {
            props.onInput(e.currentTarget.value);
            setSelected(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            const items = suggestions();
            if (!focused() || !items.length) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected(
                (selected() + (e.key === 'ArrowDown' ? 1 : -1) + items.length + 1) %
                  (items.length + 1),
              );
              if (selected() === items.length) setSelected(-1);
            } else if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              accept(selected() < 0 ? 0 : selected());
            } else if (e.key === 'Enter' && selected() >= 0) {
              const item = items[selected()];
              if (item) props.onInput(item.path);
              setFocused(false);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setFocused(false);
            }
          }}
        />
        {props.trailing}
      </div>
      <Show when={suggestions().length}>
        <PathSuggestions id={id} entries={suggestions()} selected={selected()} onAccept={accept} />
      </Show>
    </div>
  );
}
