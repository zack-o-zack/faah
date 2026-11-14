import { appendFileSync } from 'node:fs';

export interface RGProfile {
  resolveMs: number;
  spawnMs: number;
  firstByteMs: number | null;
  runMs: number;
  parseMs: number;
  acceptMs: number;
  events: number;
  bytes: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  searchedFiles?: number;
  searchedBytes?: number;
}
export interface SearchProfile {
  query: string;
  expression: string;
  files: number;
  batches: number;
  strategy: string;
  prepareMs: number;
  validateMs: number;
  validatedFiles: number;
  totalMs: number;
  rg: RGProfile[];
}
export function searchProfiler(): ((profile: SearchProfile) => void) | undefined {
  const path = process.env.FAAH_PROFILE_SEARCH;
  if (path) return (profile) => appendFileSync(path, JSON.stringify(profile) + '\n');
}
