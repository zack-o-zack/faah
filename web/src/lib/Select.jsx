import { For } from 'solid-js';

export function Select(props) {
  return (
    <select
      class="select"
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      <For each={props.options}>
        {(option) => <option value={option.value}>{option.label}</option>}
      </For>
    </select>
  );
}
