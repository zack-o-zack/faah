import { filterByText } from '../lib/list.ts';
import type { DocTab } from '../editor/types.ts';
import type { Command, PaletteItem, PaletteMode } from './types.ts';
export const MODES = {
  file: {
    label: 'File',
    placeholder: 'Search files, symbols and commands',
    hint: '',
    icon: 'icon-[ph--magnifying-glass]',
  },
  symbol: {
    label: 'Symbol',
    placeholder: 'Go to symbol',
    hint: 'Symbols in the active file.',
    icon: 'icon-[ph--code]',
  },
  line: {
    label: 'Line',
    placeholder: 'Go to line',
    hint: 'Enter a line number.',
    icon: 'icon-[ph--hash]',
  },
  command: {
    label: 'Command',
    placeholder: 'Run a command',
    hint: '',
    icon: 'icon-[ph--terminal-window]',
  },
  theme: {
    label: 'Theme',
    placeholder: 'Select a theme',
    hint: 'Arrows preview a theme. Enter keeps it, Esc restores the previous one.',
    icon: 'icon-[ph--palette]',
  },
  openpr: {
    label: 'Open PR',
    placeholder: 'Paste a pull request URL',
    hint: 'Full pull request URL (e.g. https://github.com/owner/repo/pull/123), then Enter.',
    icon: 'icon-[ph--git-pull-request]',
  },
};
export function emptyFileItems(
  documents: readonly Pick<DocTab, 'path' | 'name'>[],
  activePath: string | undefined,
): PaletteItem[] {
  const active = documents.find((document) => document.path === activePath);
  const ordered = active
    ? [active, ...documents.filter((document) => document !== active)]
    : documents;
  return [
    ...ordered.slice(0, 5).map((document): PaletteItem => ({
      kind: 'open-file',
      path: document.path,
      label: document.name,
      sub: document.path.slice(0, Math.max(0, document.path.length - document.name.length - 1)),
      positions: [],
    })),
    { kind: 'jump', mode: 'symbol', label: 'Symbol in this file', hint: 'type @' },
    { kind: 'jump', mode: 'line', label: 'Line', hint: 'type :', keys: 'Mod+G' },
    { kind: 'jump', mode: 'command', label: 'Run a command', hint: 'type >', keys: 'Mod+Shift+K' },
    { kind: 'jump', mode: 'openpr', label: 'Open a pull request', hint: 'paste a link' },
  ];
}
export interface PaletteSection {
  label?: string;
  entries: { item: PaletteItem; index: number }[];
}
export function paletteSections(items: PaletteItem[]): PaletteSection[] {
  const sections: PaletteSection[] = [];
  for (const [index, item] of items.entries()) {
    let label: string | undefined;
    if (item.kind === 'open-file') label = 'Open files';
    else if (item.kind === 'jump') label = 'Jump to';
    let section = sections.at(-1);
    if (!section || section.label !== label) {
      section = { label, entries: [] };
      sections.push(section);
    }
    section.entries.push({ item, index });
  }
  return sections;
}
export function paletteHint(mode: PaletteMode, query: string): string {
  return mode === 'file' && !query ? 'Type to search every file' : MODES[mode].hint;
}
export function itemIcon(item: PaletteItem): string | undefined {
  if (item.kind === 'jump') return MODES[item.mode].icon;
  if (item.kind === 'command') return 'icon-[ph--lightning]';
  if (item.kind === 'symbol' || item.kind === 'line') return MODES[item.kind].icon;
  return undefined;
}
export function itemHint(item: PaletteItem): string | undefined {
  if (item.kind === 'jump') return item.hint;
  return 'sub' in item ? item.sub : undefined;
}
export function paletteQuery(input: string, base: string): { mode: PaletteMode; query: string } {
  if (base === 'theme' || base === 'openpr') return { mode: base, query: input.trim() };
  const prefixes: Record<string, PaletteMode> = { '>': 'command', '@': 'symbol', ':': 'line' };
  const mode = prefixes[input[0] || ''] || 'file';
  return { mode, query: (mode === 'file' ? input : input.slice(1)).trim() };
}
export function fuzzyParts(
  text: string,
  positions: number[] = [],
): { text: string; bold: boolean }[] {
  const hits = new Set(positions);
  const parts: { text: string; bold: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const bold = hits.has(i);
    const last = parts.at(-1);
    if (last && last.bold === bold) last.text += text[i] || '';
    else parts.push({ text: text[i] || '', bold });
  }
  return parts;
}
export function itemParts(item: PaletteItem): { text: string; bold: boolean }[] {
  const positions =
    item.kind === 'file'
      ? item.positions
          .filter((position) => position >= item.path.length - item.label.length)
          .map((position) => position - item.path.length + item.label.length)
      : [];
  return fuzzyParts(item.label, positions);
}
export function rankCommands(commands: Command[], query: string): PaletteItem[] {
  return filterByText(commands, query, (command) => command.name).map((command) => ({
    kind: 'command',
    command,
    label: command.name,
  }));
}
