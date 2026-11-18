import { createEffect, type Component } from 'solid-js';
import { useSettings } from './context.ts';
import { typographyVariables } from './logic.ts';

/** Derived appearance settings land on the document root. Renders nothing. */
export const PreferenceStyles: Component = () => {
  const settings = useSettings();
  createEffect(() => {
    document.documentElement.dataset.transparency = settings.preferences().transparency;
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(typographyVariables(settings.preferences())))
      style.setProperty(name, value);
  });
  return null;
};
