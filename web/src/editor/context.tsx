import type { EditorStore } from './store.ts';
import { createContext, useContext } from 'solid-js';
const Context = createContext<EditorStore>();
export const EditorProvider = Context.Provider;
export function useEditor(): EditorStore {
  const editor = useContext(Context);
  if (!editor) throw new Error('useEditor requires EditorProvider');
  return editor;
}
