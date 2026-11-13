import { createResource, createSignal, createUniqueId, onMount, Show } from 'solid-js';
import { api } from '../lib/api.ts';
import { looksLikeURL } from './logic.js';
import { PathSuggestions } from './PathSuggestions.jsx';
export function PathInput(props) {
  const [focused, setFocused] = createSignal(false);
  const [selected, setSelected] = createSignal(-1);
  const id = createUniqueId();
  let input;
  onMount(() => {
    if (props.autofocus) input.focus();
    props.onReady?.(() => input.focus());
  });
  const [entries] = createResource(
    () => (focused() && props.value.trim() && !looksLikeURL(props.value) ? props.value : false),
    async (q) => {
      try {
        return (await api('api/wb/complete', { q })).entries || [];
      } catch {
        return [];
      }
    },
  );
  const accept = (index) => {
    const item = entries()?.[index];
    if (!item) return;
    props.onInput(item.path);
    props.onFolder?.(item.path);
    setSelected(-1);
    input.focus();
  };
  return (
    <div class="dropdown-menu relative flex-1">
      <input
        ref={(el) => {
          input = el;
        }}
        class="input w-full"
        value={props.value}
        aria-label={props.label}
        placeholder={props.placeholder}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={id}
        aria-expanded={focused() && !!entries()?.length}
        aria-activedescendant={selected() >= 0 ? `${id}-${selected()}` : undefined}
        onInput={(e) => {
          props.onInput(e.currentTarget.value);
          setSelected(-1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          const items = entries() || [];
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
            props.onInput(items[selected()].path);
            setFocused(false);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setFocused(false);
          }
        }}
      />
      <Show when={focused() && entries()?.length}>
        <PathSuggestions id={id} entries={entries()} selected={selected()} onAccept={accept} />
      </Show>
    </div>
  );
}
