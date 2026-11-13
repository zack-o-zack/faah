import { createSignal } from 'solid-js';

export type ShortcutSection =
  'General' | 'Navigation' | 'Search' | 'Editing' | 'Selection' | 'Tabs' | 'Diff and preview';

export const SECTIONS: readonly ShortcutSection[] = [
  'General',
  'Navigation',
  'Search',
  'Editing',
  'Selection',
  'Tabs',
  'Diff and preview',
];

/** One row of the help sheet: alternative key combos (or gestures) and what they do. */
export interface ShortcutHelp {
  keys: string[];
  label: string;
  section: ShortcutSection;
}

export interface HelpGroup {
  section: ShortcutSection;
  entries: ShortcutHelp[];
}

/**
 * The shortcuts the app binds right now, as their owners describe them. The help sheet
 * lists exactly these, so a removed binding leaves the sheet with it.
 */
export function createShortcutRegistry(): ReturnType<typeof buildShortcutRegistry> {
  return buildShortcutRegistry();
}
function buildShortcutRegistry() {
  const [entries, setEntries] = createSignal<readonly ShortcutHelp[]>([]);
  const [helpOpen, setHelpOpen] = createSignal(false);
  function describe(list: ShortcutHelp[]): () => void {
    setEntries((current) => [...current, ...list]);
    return () => setEntries((current) => current.filter((entry) => !list.includes(entry)));
  }
  function groups(): HelpGroup[] {
    return SECTIONS.map((section) => ({
      section,
      entries: entries().filter((entry) => entry.section === section),
    })).filter((group) => group.entries.length > 0);
  }
  return {
    entries,
    groups,
    describe,
    helpOpen,
    actions: {
      showHelp: () => setHelpOpen(true),
      hideHelp: () => setHelpOpen(false),
    },
  };
}

export type ShortcutRegistry = ReturnType<typeof buildShortcutRegistry>;

/** [c ]c [f ]f: a bracket, then a letter within this many milliseconds. */
export const CHORD_WINDOW = 900;

export interface Chord {
  prefix: '[' | ']';
  at: number;
}

/** The direction and target of a completed bracket chord, or null. */
export function chordStep(
  chord: Chord | null,
  key: string,
  now: number,
): { target: 'hunk' | 'file'; direction: 1 | -1 } | null {
  if (!chord || now - chord.at >= CHORD_WINDOW) return null;
  const direction = chord.prefix === ']' ? 1 : -1;
  if (key === 'c') return { target: 'hunk', direction };
  if (key === 'f') return { target: 'file', direction };
  return null;
}
