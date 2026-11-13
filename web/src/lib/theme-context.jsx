import { createContext, untrack, useContext } from 'solid-js';
import { createThemeStore } from './theme.ts';
const ThemeContext = createContext();
export function ThemeProvider(props) {
  // Store injection is fixed for the lifetime of this provider.
  const store = untrack(() => props.store) || createThemeStore(untrack(() => props.options));
  return <ThemeContext.Provider value={store}>{props.children}</ThemeContext.Provider>;
}
export const useTheme = () => {
  const store = useContext(ThemeContext);
  if (!store) throw new Error('useTheme requires ThemeProvider');
  return store;
};
