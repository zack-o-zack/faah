import { For, Match, Show, Switch, type Component } from 'solid-js';
import { useSettings } from './context.ts';
import { segmentValue, type SettingControl as Control, type SettingItem } from './logic.ts';

interface ControlProps {
  item: SettingItem;
  control: Control;
}

const Segments: Component<{ item: SettingItem; options: (string | number)[]; label: string }> = (
  props,
) => {
  const settings = useSettings();
  const current = () => String(settings.value(props.item.key) ?? '');
  return (
    <div class="button-group" role="group" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="btn"
            data-size="sm"
            aria-pressed={current() === String(option)}
            data-variant={current() === String(option) ? 'secondary' : 'outline'}
            onClick={() =>
              void settings.actions.setSetting(
                props.item.key,
                typeof option === 'number' ? option : segmentValue(props.item, option),
              )
            }
          >
            {option}
          </button>
        )}
      </For>
    </div>
  );
};

/** The control beside a setting's title. */
export const SettingControl: Component<ControlProps & { invalid: boolean }> = (props) => {
  const settings = useSettings();
  const key = () => props.item.key;
  const id = () => 'setting-' + key();
  const current = () => settings.value(key());
  const edited = () => settings.state.edits[key()];
  return (
    <Switch>
      <Match when={props.control.kind === 'switch' && props.control}>
        {(control) => (
          <input
            id={id()}
            type="checkbox"
            role="switch"
            aria-label={props.item.title}
            class="input"
            checked={current() === control().on}
            onChange={(event) =>
              void settings.actions.setSetting(
                key(),
                event.currentTarget.checked ? control().on : control().off,
              )
            }
          />
        )}
      </Match>
      <Match when={props.control.kind === 'segments' && props.control}>
        {(control) => (
          <Segments item={props.item} options={control().options} label={props.item.title} />
        )}
      </Match>
      <Match when={props.control.kind === 'select' && props.control}>
        {(control) => (
          <select
            id={id()}
            class="select w-48"
            value={String(current() ?? '')}
            onChange={(event) => void settings.actions.setSetting(key(), event.currentTarget.value)}
          >
            <For each={control().options}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
        )}
      </Match>
      <Match when={props.control.kind === 'number'}>
        <input
          id={id()}
          type="number"
          class="input w-24 text-right tabular-nums"
          min={props.item.min}
          max={props.item.max}
          step={props.item.step ?? 1}
          aria-invalid={props.invalid}
          value={String(edited() ?? current() ?? '')}
          onInput={(event) => settings.actions.editSetting(key(), event.currentTarget.value)}
          onChange={(event) => settings.actions.commitNumber(props.item, event.currentTarget.value)}
        />
      </Match>
      <Match when={props.control.kind === 'text' && props.control}>
        {(control) => (
          <input
            id={id()}
            type={control().secret ? 'password' : 'text'}
            autocomplete={control().secret ? 'off' : undefined}
            class="input w-64"
            value={String(edited() ?? current() ?? '')}
            onInput={(event) => settings.actions.editSetting(key(), event.currentTarget.value)}
            onChange={(event) => void settings.actions.setSetting(key(), event.currentTarget.value)}
          />
        )}
      </Match>
    </Switch>
  );
};

/** A long-form field under the description. */
export const SettingField: Component<ControlProps> = (props) => {
  const settings = useSettings();
  const key = () => props.item.key;
  return (
    <Show when={props.control.kind === 'textarea' && props.control}>
      {(control) => (
        <textarea
          id={'setting-' + key()}
          rows="5"
          spellcheck={false}
          placeholder={control().placeholder}
          class="textarea mt-2 w-full resize-y font-mono text-xs"
          value={String(settings.state.edits[key()] ?? settings.value(key()) ?? '')}
          onInput={(event) => settings.actions.editSetting(key(), event.currentTarget.value)}
          onChange={(event) => void settings.actions.setSetting(key(), event.currentTarget.value)}
        />
      )}
    </Show>
  );
};

/** Common numbers, one click away. */
export const SettingPresets: Component<ControlProps> = (props) => {
  const presets = () => (props.control.kind === 'number' ? props.control.presets : []);
  return (
    <Show when={presets().length}>
      <div class="mt-2">
        <Segments item={props.item} options={presets()} label={props.item.title + ' presets'} />
      </div>
    </Show>
  );
};
