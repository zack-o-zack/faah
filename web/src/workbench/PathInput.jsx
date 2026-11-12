import { createResource, createSignal, createUniqueId, For, Show } from 'solid-js';
import { api } from '../lib/api.js';
import { looksLikeURL, tildify } from './logic.js';
import { useWorkbench } from './context.jsx';
export function PathInput(props) {
  const { state } = useWorkbench();
  const [focused, setFocused] = createSignal(false);
  const [selected, setSelected] = createSignal(-1);
  const id = createUniqueId();
  let input;
  const [entries] = createResource(() => focused() && props.value.trim() && !looksLikeURL(props.value) ? props.value : false,
    async q => { try { return (await api('api/wb/complete', { q })).entries || []; } catch { return []; } });
  const accept = index => {
    const item = entries()?.[index];
    if (!item) return;
    props.onInput(item.path); props.onFolder?.(item.path); setSelected(-1); input.focus();
  };
  return <div class="dropdown-menu relative flex-1">
    <input ref={el => { input = el; props.inputRef?.(el); }} class="input w-full" value={props.value} aria-label={props.label} placeholder={props.placeholder} spellcheck="false" autocomplete="off" autocapitalize="off" role="combobox" aria-autocomplete="list" aria-controls={id} aria-expanded={focused() && !!entries()?.length} aria-activedescendant={selected() >= 0 ? `${id}-${selected()}` : undefined} onInput={e => { props.onInput(e.currentTarget.value); setSelected(-1); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={e => {
      const items = entries() || [];
      if (!focused() || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected((selected() + (e.key === 'ArrowDown' ? 1 : -1) + items.length + 1) % (items.length + 1)); if (selected() === items.length) setSelected(-1); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); accept(selected() < 0 ? 0 : selected()); }
      else if (e.key === 'Enter' && selected() >= 0) { props.onInput(items[selected()].path); setFocused(false); }
      else if (e.key === 'Escape') { e.preventDefault(); setFocused(false); }
    }} />
    <Show when={focused() && entries()?.length}><ul id={id} role="listbox" data-popover class="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-auto">
      <For each={entries()}>{(entry, index) => <li id={`${id}-${index()}`} role="option" aria-selected={index() === selected()} class="item cursor-pointer aria-selected:bg-accent" onMouseDown={e => { e.preventDefault(); accept(index()); }}>
        <span class={entry.git ? 'icon-[lucide--folder-git-2] size-4 text-gi' : 'icon-[lucide--folder] size-4'} /><span>{entry.name}</span><span class="truncate text-xs text-muted-foreground">{tildify(entry.path, state.home, state.sep)}</span>
      </li>}</For>
    </ul></Show>
  </div>;
}
