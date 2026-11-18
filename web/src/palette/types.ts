export interface Command {
  id?: string;
  name: string;
  run: () => unknown;
}
export type PaletteMode = 'file' | 'symbol' | 'line' | 'command' | 'theme' | 'openpr';
export type PaletteItem =
  | { kind: 'file' | 'open-file'; path: string; label: string; sub: string; positions: number[] }
  | { kind: 'line' | 'symbol'; line: number; label: string; sub: string }
  | { kind: 'command'; command: Command; label: string }
  | { kind: 'theme'; id: string; label: string; sub: string }
  | { kind: 'openpr'; target: string; label: string }
  | { kind: 'jump'; mode: PaletteMode; label: string; hint: string; keys?: string };
