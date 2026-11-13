import type { Command, PaletteItem, PaletteMode } from './types.ts';
export const MODES = {
  file: {
    label: 'File',
    placeholder: 'Search files by name',
    hint: 'Prefix : for a line, @ for a symbol, > for a command.',
  },
  symbol: { label: 'Symbol', placeholder: 'Go to symbol', hint: 'Symbols in the active file.' },
  line: { label: 'Line', placeholder: 'Go to line', hint: 'Enter a line number.' },
  command: { label: 'Command', placeholder: 'Run a command', hint: '' },
  theme: {
    label: 'Theme',
    placeholder: 'Select a theme',
    hint: 'Arrows preview. Enter keeps it; Esc restores the previous theme.',
  },
  openpr: {
    label: 'Open PR',
    placeholder: 'Paste a pull request URL',
    hint: 'Enter to open in a new tab.',
  },
};
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
export function rankCommands(commands: Command[], query: string): PaletteItem[] {
  const needle = query.toLowerCase();
  return commands
    .filter((command) => command.name.toLowerCase().includes(needle))
    .map((command) => ({ kind: 'command', command, label: command.name }));
}
export function scrollToItem(
  top: number,
  height: number,
  itemTop: number,
  itemHeight: number,
): number {
  if (itemTop < top) return itemTop;
  if (itemTop + itemHeight > top + height) return itemTop + itemHeight - height;
  return top;
}
