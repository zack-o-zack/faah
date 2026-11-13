import { createEffect, Show, type Component } from 'solid-js';
import { useSettings } from './context.ts';
import { isModified, settingControl, shownDefault, type SettingItem } from './logic.ts';
import { SettingControl, SettingField, SettingPresets } from './SettingControl.tsx';

interface SettingCardProps {
  item: SettingItem;
  onVimHelp: () => void;
}

export const SettingCard: Component<SettingCardProps> = (props) => {
  const settings = useSettings();
  const key = () => props.item.key;
  const fallback = () => settings.state.defaults[key()] ?? props.item.default;
  const modified = () => isModified(settings.state.values[key()], fallback());
  const control = () => settingControl(props.item);
  const error = () => settings.state.invalid[key()];
  let card: HTMLDivElement | undefined;
  // Opening Settings on one setting scrolls to it and focuses its control.
  createEffect(() => {
    if (settings.state.dialog.focus !== key() || !card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.querySelector<HTMLElement>('textarea, input, select')?.focus();
    settings.actions.settingFocused();
  });
  return (
    <div
      ref={card}
      class="field gap-6 border-b py-4 last:border-b-0"
      data-orientation="horizontal"
      data-setting={key()}
    >
      <section class="min-w-0 gap-1">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <label for={'setting-' + key()} class="label">
            {props.item.title}
          </label>
          <code class="font-mono text-xs text-muted-foreground">{key()}</code>
          <Show when={modified()}>
            <span class="badge" data-variant="outline">
              Modified
            </span>
          </Show>
        </div>
        <p class="text-sm text-muted-foreground">{props.item.description}</p>
        <SettingField item={props.item} control={control()} />
        <SettingPresets item={props.item} control={control()} />
        <Show when={error()}>
          <div role="alert" class="text-destructive">
            {error()}
          </div>
        </Show>
        <Show when={key() === 'editor.vimMode'}>
          <button
            type="button"
            class="btn mt-1 -ml-2 self-start"
            data-variant="link"
            data-size="sm"
            title="Also opens with ? in Normal mode"
            onClick={() => props.onVimHelp()}
          >
            Vim keybindings cheat sheet
          </button>
        </Show>
      </section>
      <div class="flex shrink-0 items-center gap-2">
        <Show when={modified()}>
          <button
            type="button"
            class="btn"
            data-variant="ghost"
            data-size="sm"
            title={`Reset to default (${shownDefault(fallback())})`}
            onClick={() => settings.actions.resetSetting(key())}
          >
            Reset
          </button>
        </Show>
        <SettingControl item={props.item} control={control()} invalid={!!error()} />
      </div>
    </div>
  );
};
