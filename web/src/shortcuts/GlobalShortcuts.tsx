import { onCleanup, type Component } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { createShortcut } from '../lib/shortcuts.tsx';
import { chordStep, type Chord, type ShortcutHelp, type ShortcutRegistry } from './registry.ts';

type InspectorTab = 'search' | 'symbols';
type PaletteMode = 'file' | 'command' | 'line';

/** What the app-wide shortcuts reach in the editor store. */
interface ShortcutEditor {
  shortcuts: ShortcutRegistry;
  active: () => { isImage?: boolean; view?: string } | null;
  store: { state: { workspace: { meta: { git?: boolean } | null }; layout: LayoutState } };
  services: {
    imageKey?: (event: KeyboardEvent) => boolean;
    preview?: { key: (event: KeyboardEvent) => boolean };
    diagramFullscreens?: (() => boolean)[];
  };
  actions: {
    openSettings: (mode: 'ui' | 'json') => void;
    openPalette: (mode: PaletteMode) => void;
    showRightInspector: (tab?: InspectorTab) => void;
    hideRightInspector: () => void;
    hideThreads: () => void;
    togglePanel: (panel: 'left') => void;
    reindexWorkspace: () => Promise<void>;
    toggleActiveDiff: () => void;
    toggleActivePreview: () => void;
    stepDiffHunk: (direction: 1 | -1) => void;
    stepChangedFile: (direction: 1 | -1) => Promise<void>;
    showHelp: () => void;
  };
}
interface LayoutState {
  right: boolean;
  threads: boolean;
}

const fieldSelector = 'input, textarea, select, [contenteditable="true"]';
const inField = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && target.matches(fieldSelector);
const inDialog = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest('dialog');
const previewing = (view: string | undefined): boolean => view === 'markdown' || view === 'table';
const NAVIGATION_KEYS = [
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ' ',
  'Enter',
];
/** A focused button, link or menu item keeps ordinary navigation keys for itself. */
const ownsNavigation = (event: KeyboardEvent): boolean =>
  NAVIGATION_KEYS.includes(event.key) &&
  event.target instanceof Element &&
  !!event.target.closest(
    'button, a[href], select, [role="button"], [role="tab"], [role^="menuitem"]',
  );

/** Keys that work anywhere in the app, outside the editor's own bindings. Renders nothing. */
export const GlobalShortcuts: Component = () => {
  const editor: ShortcutEditor = useEditor();
  const actions = editor.actions;
  const bind = (combo: string, action: (event: KeyboardEvent) => void, inputs = true) =>
    createShortcut(combo, action, { inputs, capture: true, stopPropagation: true });

  bind('Mod+,', () => actions.openSettings('ui'));
  bind('Mod+K', () => actions.openPalette('file'));
  bind('Mod+Shift+K', () => actions.openPalette('command'));
  bind('Mod+G', () => actions.openPalette('line'));
  bind('Mod+J', () => {
    if (editor.store.state.layout.right) actions.hideRightInspector();
    else actions.showRightInspector();
  });
  bind('Mod+Shift+O', () => actions.showRightInspector('symbols'));
  bind('Mod+Shift+F', () => actions.showRightInspector('search'));
  bind('Mod+Shift+R', () => void actions.reindexWorkspace());
  bind('Mod+B', () => actions.togglePanel('left'));
  createShortcut('Mod+D', actions.toggleActiveDiff, {
    inputs: true,
    capture: true,
    stopPropagation: true,
    // Without git there is no diff; the browser keeps the key.
    when: () => !!editor.store.state.workspace.meta?.git,
  });
  bind('Alt+M', actions.toggleActivePreview);
  // ? is a shifted key on most layouts and a plain one on some.
  bind('?', actions.showHelp, false);
  bind('Shift+?', actions.showHelp, false);

  // Escape closes the innermost thing open; dialogs and menus close themselves first.
  createShortcut(
    'Escape',
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || inDialog(event.target)) return;
      if (editor.services.diagramFullscreens?.some((exit) => exit())) event.preventDefault();
      else if (editor.store.state.layout.threads) actions.hideThreads();
      else if (editor.store.state.layout.right) actions.hideRightInspector();
      else if (inField(event.target)) event.target.blur();
    },
    { inputs: true, preventDefault: false },
  );

  let chord: Chord | null = null;
  createShortcut(
    null,
    (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || ownsNavigation(event)) return;
      if (event.key === '[' || event.key === ']') {
        chord = { prefix: event.key, at: performance.now() };
        return;
      }
      const step = chordStep(chord, event.key, performance.now());
      chord = null;
      if (step) {
        event.preventDefault();
        if (step.target === 'hunk') actions.stepDiffHunk(step.direction);
        else void actions.stepChangedFile(step.direction);
        return;
      }
      // Images and previews take their own navigation keys.
      const document = editor.active();
      const handled = document?.isImage
        ? editor.services.imageKey?.(event)
        : previewing(document?.view) && editor.services.preview?.key(event);
      if (handled) event.preventDefault();
    },
    { preventDefault: false },
  );

  onCleanup(editor.shortcuts.describe(HELP));
  return null;
};

const HELP: ShortcutHelp[] = [
  { keys: ['Mod+,'], label: 'Open settings', section: 'General' },
  { keys: ['Mod+K'], label: 'Quick search', section: 'General' },
  { keys: ['Mod+Shift+K'], label: 'Command palette', section: 'General' },
  { keys: ['Mod+Shift+R'], label: 'Refresh workspace', section: 'General' },
  { keys: ['?'], label: 'Keyboard shortcuts', section: 'General' },
  { keys: ['Esc'], label: 'Dismiss', section: 'General' },
  { keys: ['Mod+G'], label: 'Go to line', section: 'Navigation' },
  { keys: ['Mod+Shift+O'], label: 'Go to symbol', section: 'Navigation' },
  { keys: ['Mod+B'], label: 'Toggle sidebar', section: 'Navigation' },
  { keys: ['Mod+J'], label: 'Toggle right sidebar / inspector', section: 'Navigation' },
  { keys: ['Mod+Shift+F'], label: 'Search in files', section: 'Search' },
  { keys: ['Mod+D'], label: 'Toggle diff view (git)', section: 'Diff and preview' },
  { keys: ['[c', ']c'], label: 'Previous / next diff hunk', section: 'Diff and preview' },
  { keys: ['[f', ']f'], label: 'Previous / next changed file', section: 'Diff and preview' },
  { keys: ['Alt+M'], label: 'Toggle Markdown / table preview', section: 'Diff and preview' },
];
