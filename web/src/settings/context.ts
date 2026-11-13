import { createContext, useContext } from 'solid-js';
import type { SettingsStore } from './store.ts';

const SettingsContext = createContext<SettingsStore>();
export const SettingsProvider = SettingsContext.Provider;

export function useSettings(): SettingsStore {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('useSettings requires SettingsProvider');
  return settings;
}
