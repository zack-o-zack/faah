import type { SetStoreFunction } from 'solid-js/store';
import type { AppState } from '../app/store.ts';
import type { PanelName } from './logic.ts';
import { batch } from 'solid-js';
import { INSPECTOR_TABS } from './logic.ts';
export function createLayoutActions(
  app: { state: AppState },
  set: SetStoreFunction<AppState>,
): LayoutActions {
  function persist(): void {
    localStorage.setItem('faah.layout', JSON.stringify(app.state.layout));
  }
  function setPanelVisible(name: PanelName, visible: boolean): void {
    if (!['left', 'right', 'threads'].includes(name)) throw new Error('Unknown panel');
    batch(() => {
      set('layout', name, visible);
      if (visible && name === 'right') set('layout', 'threads', false);
      if (visible && name === 'threads') set('layout', 'right', false);
    });
    persist();
  }
  function setInspectorTab(tab: string): void {
    if (!INSPECTOR_TABS.includes(tab)) return;
    set('layout', 'inspector', tab);
    persist();
  }
  return {
    setPanelVisible,
    setInspectorTab,
    togglePanel: (name: PanelName) => setPanelVisible(name, !app.state.layout[name]),
    setPanelWidth(name: PanelName, value: number) {
      const limits: Record<PanelName, [number, number]> = {
        left: [170, 620],
        right: [200, 700],
        threads: [240, 900],
      };
      if (!limits[name] || !Number.isFinite(value)) return;
      const key = { left: 'leftWidth', right: 'rightWidth', threads: 'threadsWidth' }[name];
      if (key !== 'leftWidth' && key !== 'rightWidth' && key !== 'threadsWidth') return;
      set('layout', key, Math.max(limits[name][0], Math.min(limits[name][1], value)));
      persist();
    },
    showRightInspector(tab?: string) {
      setInspectorTab(tab || app.state.layout.inspector);
      setPanelVisible('right', true);
    },
    hideRightInspector: () => setPanelVisible('right', false),
  };
}

export interface LayoutActions {
  setPanelVisible: (name: PanelName, visible: boolean) => void;
  setInspectorTab: (tab: string) => void;
  togglePanel: (name: PanelName) => void;
  setPanelWidth: (name: PanelName, value: number) => void;
  showRightInspector: (tab?: string) => void;
  hideRightInspector: () => void;
}
