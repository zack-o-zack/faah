import type { JSX } from 'solid-js';
import type { createWorkbenchStore as CreateStore } from './store.ts';
interface WorkbenchProviderProps {
  store?: ReturnType<typeof CreateStore>;
  children?: JSX.Element;
}
import { createContext, untrack, useContext } from 'solid-js';
import { createWorkbenchStore } from './store.ts';
const Context = createContext<ReturnType<typeof CreateStore>>();
export function WorkbenchProvider(props: WorkbenchProviderProps): JSX.Element {
  // Store injection is fixed for the lifetime of this provider.
  const store = untrack(() => props.store) || createWorkbenchStore();
  return <Context.Provider value={store}>{props.children}</Context.Provider>;
}
export const useWorkbench = (): ReturnType<typeof CreateStore> => {
  const store = useContext(Context);
  if (!store) throw new Error('useWorkbench requires WorkbenchProvider');
  return store;
};
