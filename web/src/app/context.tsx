import type { JSX } from 'solid-js';
import type { AppStore } from './store.ts';
interface AppProviderProps {
  store?: AppStore;
  children?: JSX.Element;
}
import { createContext, onCleanup, untrack, useContext } from 'solid-js';
import { createAppStore } from './store.ts';
const AppContext = createContext<AppStore>();
export function AppProvider(props: AppProviderProps): JSX.Element {
  // Store injection is fixed for the lifetime of this provider.
  const store = untrack(() => props.store) || createAppStore();
  onCleanup(store.actions.disposeDocuments);
  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}
export function useApp(): AppStore {
  const store = useContext(AppContext);
  if (!store) throw new Error('useApp requires AppProvider');
  return store;
}
