import { createContext, useContext } from 'solid-js';
import { createThemeStore } from './theme.js';
const ThemeContext = createContext();
export function ThemeProvider(props) {
  const store = props.store || createThemeStore();
  return <ThemeContext.Provider value={store}>{props.children}</ThemeContext.Provider>;
}
export const useTheme = () => {
  const store = useContext(ThemeContext);
  if (!store) throw new Error('useTheme requires ThemeProvider');
  return store;
};
