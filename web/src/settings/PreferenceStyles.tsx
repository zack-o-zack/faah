import { createEffect, type Component } from 'solid-js';
import { useSettings } from './context.ts';
import { typographyVariables } from './logic.ts';

/** Type settings land on the document root as CSS variables. Renders nothing. */
export const PreferenceStyles: Component = () => {
  const settings = useSettings();
  createEffect(() => {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(typographyVariables(settings.preferences())))
      style.setProperty(name, value);
  });
  return null;
};
