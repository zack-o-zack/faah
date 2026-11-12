import { createContext, useContext } from 'solid-js';
import { createAppStore } from './store.js';
const AppContext = createContext();
export function AppProvider(props) {
  const store = props.store || createAppStore();
  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}
export function useApp() {
  const store = useContext(AppContext);
  if (!store) throw new Error('useApp requires AppProvider');
  return store;
}
