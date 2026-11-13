import { readFile } from 'node:fs/promises';
import { array, num, object, str } from './util.ts';

export function verify(value: unknown): string[] {
  const notes: string[] = [];
  const root = object(value);
  if (!root.workbench) throw new Error('Missing workbench result');
  for (const entry of array(root.repos)) {
    const repo = object(entry);
    const name = str(repo.name);
    for (const entry of array(repo.latency)) {
      const row = object(entry);
      const scenario = str(row.name);
      for (const entry of array(row.samples)) {
        const sample = object(entry);
        if (num(sample.status) !== 200 || num(sample.bytes) <= 0)
          throw new Error(`${name}/${scenario}: invalid response`);
        const count = num(sample.count);
        if (scenario === 'find.3' || scenario === 'search.no-hit') {
          if (count !== 0) throw new Error(`${name}/${scenario}: unexpected matches`);
        } else if (count === 0) {
          throw new Error(`${name}/${scenario}: empty result; inspect fixture`);
        }
        if (object(sample.counts).indexing === true) throw new Error('Find index still building');
      }
    }
    for (const entry of array(repo.throughput)) {
      const row = object(entry);
      if (num(row.errorCount) !== 0) throw new Error(`${name}: load errors`);
    }
    const response = object(repo.responsiveness);
    for (const key of ['meta', 'search']) {
      if (num(object(response[key]).errorCount) !== 0)
        throw new Error(`${name}: responsiveness errors`);
    }
    for (const entry of array(repo.sse)) {
      const row = object(entry);
      if (num(row.timeouts) > 0)
        notes.push(`${name}: ${str(row.mode)} ${num(row.timeouts)} SSE timeouts`);
    }
    for (const entry of array(repo.skipped))
      notes.push(`${name}: ${str(object(entry).scenario)} skipped (${str(object(entry).reason)})`);
    notes.push(`${name}: response statuses/counts and load errors passed`);
  }
  return notes;
}
if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: bun bench/verify.ts RESULT.json');
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  console.log(verify(value).join('\n'));
}
