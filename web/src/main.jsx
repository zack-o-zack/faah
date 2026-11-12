import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { AppProvider } from './app/context.jsx';
import { ThemeProvider, useTheme } from './lib/theme-context.jsx';
import { Toaster } from './lib/toast.jsx';
import { attachLegacyTheme } from './app/theme-bridge.js';
import { initLegacy } from './main.js';
function App() {
  attachLegacyTheme(useTheme());
  // Removed when the last legacy module is migrated.
  onMount(initLegacy);
  return <Toaster />;
}
render(
  () => (
    <AppProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AppProvider>
  ),
  document.getElementById('solid-root'),
);
