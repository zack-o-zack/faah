import { createContext, useContext } from 'solid-js';
const Context = createContext();
export const EditorProvider = Context.Provider;
export function useEditor() {
  const editor = useContext(Context);
  if (!editor) throw new Error('useEditor requires EditorProvider');
  return editor;
}
