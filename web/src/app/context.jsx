import { createContext, onCleanup, untrack, useContext } from 'solid-js';
import { createAppStore } from './store.js';
const AppContext = createContext();
export function AppProvider(props) {
  // Store injection is fixed for the lifetime of this provider.
  const store = untrack(() => props.store) || createAppStore();
  onCleanup(store.actions.disposeDocuments);
  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}
export function useApp() {
  const store = useContext(AppContext);
  if (!store) throw new Error('useApp requires AppProvider');
  return store;
}
