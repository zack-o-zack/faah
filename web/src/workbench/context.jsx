import { createContext, untrack, useContext } from 'solid-js';
import { createWorkbenchStore } from './store.ts';
const Context = createContext();
export function WorkbenchProvider(props) {
  // Store injection is fixed for the lifetime of this provider.
  const store = untrack(() => props.store) || createWorkbenchStore();
  return <Context.Provider value={store}>{props.children}</Context.Provider>;
}
export const useWorkbench = () => {
  const store = useContext(Context);
  if (!store) throw new Error('useWorkbench requires WorkbenchProvider');
  return store;
};
