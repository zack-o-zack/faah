import { createContext, useContext } from 'solid-js';
import { createWorkbenchStore } from './store.js';
const Context = createContext();
export function WorkbenchProvider(props) {
  const store = props.store || createWorkbenchStore();
  return <Context.Provider value={store}>{props.children}</Context.Provider>;
}
export const useWorkbench = () => {
  const store = useContext(Context);
  if (!store) throw new Error('useWorkbench requires WorkbenchProvider');
  return store;
};
