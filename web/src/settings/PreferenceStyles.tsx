import { createEffect, type Component } from 'solid-js';
import { useSettings } from './context.ts';
import { preferenceClasses, typographyVariables } from './logic.ts';

/** Settings that style the editor land on the document root and body. Renders nothing. */
export const PreferenceStyles: Component = () => {
  const settings = useSettings();
  createEffect(() => {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(typographyVariables(settings.preferences())))
      style.setProperty(name, value);
  });
  createEffect(() => {
    for (const [name, on] of Object.entries(preferenceClasses(settings.preferences())))
      document.body.classList.toggle(name, on);
  });
  return null;
};
