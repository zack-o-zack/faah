import type { JSX } from 'solid-js';
import type { ThemeStore, ThemeOptions } from './theme.ts';
interface ThemeProviderProps {
  store?: ThemeStore;
  options?: ThemeOptions;
  children?: JSX.Element;
}
import { createContext, untrack, useContext } from 'solid-js';
import { createThemeStore } from './theme.ts';
const ThemeContext = createContext<ThemeStore>();
export function ThemeProvider(props: ThemeProviderProps): JSX.Element {
  // Store injection is fixed for the lifetime of this provider.
  const store = untrack(() => props.store) || createThemeStore(untrack(() => props.options));
  return <ThemeContext.Provider value={store}>{props.children}</ThemeContext.Provider>;
}
export const useTheme = (): ThemeStore => {
  const store = useContext(ThemeContext);
  if (!store) throw new Error('useTheme requires ThemeProvider');
  return store;
};
