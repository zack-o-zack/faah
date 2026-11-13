import { render } from 'solid-js/web';
import { AppProvider, useApp } from './app/context.jsx';
import { ThemeProvider } from './lib/theme-context.jsx';
import { App } from './app/App.tsx';

// The theme follows the color theme setting; picking one saves it.
function SettingsThemeProvider(props) {
  const app = useApp();
  return (
    <ThemeProvider
      options={{
        configured: () => app.settings.preferences().colorTheme,
        save: (id) => void app.settings.actions.setSetting('workbench.colorTheme', id),
      }}
    >
      {props.children}
    </ThemeProvider>
  );
}
render(
  () => (
    <AppProvider>
      <SettingsThemeProvider>
        <App />
      </SettingsThemeProvider>
    </AppProvider>
  ),
  document.getElementById('root'),
);
