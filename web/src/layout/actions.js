import { batch } from 'solid-js';
export function createLayoutActions(app, set) {
  function persist() {
    localStorage.setItem('faah.layout', JSON.stringify(app.state.layout));
  }
  function setPanelVisible(name, visible) {
    if (!['left', 'right', 'threads'].includes(name)) throw new Error('Unknown panel');
    batch(() => {
      set('layout', name, visible);
      if (visible && name === 'right') set('layout', 'threads', false);
      if (visible && name === 'threads') set('layout', 'right', false);
    });
    persist();
  }
  function setInspectorTab(tab) {
    if (!['refs', 'symbols', 'calls', 'search', 'tips'].includes(tab)) return;
    set('layout', 'inspector', tab);
    persist();
  }
  return {
    setPanelVisible,
    setInspectorTab,
    togglePanel: (name) => setPanelVisible(name, !app.state.layout[name]),
    setPanelWidth(name, value) {
      const limits = { left: [170, 620], right: [200, 700], threads: [240, 900] };
      if (!limits[name] || !Number.isFinite(value)) return;
      set('layout', name + 'Width', Math.max(limits[name][0], Math.min(limits[name][1], value)));
      persist();
    },
    showRightInspector(tab) {
      setInspectorTab(tab || app.state.layout.inspector);
      setPanelVisible('right', true);
    },
    hideRightInspector: () => setPanelVisible('right', false),
  };
}
