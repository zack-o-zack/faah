import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { AppProvider, useApp } from './app/context.tsx';
import { ThemeProvider } from './lib/theme-context.tsx';
import { App } from './app/App.tsx';

// The theme follows the color theme setting; picking one saves it.
function SettingsThemeProvider(props: { children?: JSX.Element }): JSX.Element {
  const app = useApp();
  return (
    <ThemeProvider
      options={{
        configured: () => app.settings.preferences().colorTheme,
        // The server injects the stored choices before first paint; the
        // settings take over once they have loaded.
        codeThemes: () => {
          if (!app.settings.state.loaded) return undefined;
          const prefs = app.settings.preferences();
          return { light: prefs.codeThemeLight, dark: prefs.codeThemeDark };
        },
        save: (id) => void app.settings.actions.setSetting('workbench.colorTheme', id),
      }}
    >
      {props.children}
    </ThemeProvider>
  );
}
const mount = document.getElementById('root');
if (!mount) throw new Error('Missing root mount point');
render(
  () => (
    <AppProvider>
      <SettingsThemeProvider>
        <App />
      </SettingsThemeProvider>
    </AppProvider>
  ),
  mount,
);
