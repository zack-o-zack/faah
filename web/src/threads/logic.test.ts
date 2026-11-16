import { expect, test } from 'vitest';
import { explainRequest } from './logic.ts';
import type { ExplainInput } from './decode.ts';

test('every explain request contains only a reference and optional symbol', () => {
  const cases: ExplainInput[] = [
    { path: 'a.go', file: true },
    { path: 'a.go', l1: 2, l2: 5, text: 'PRIVATE_FILE_BODY\nmore source' },
    { path: 'a.go', l1: 2, l2: 2, c1: 3, c2: 6, text: 'Run' },
    { path: 'a.go', l1: 2, l2: 2, symbol: 'Run' },
  ];
  for (const target of cases) {
    const request = explainRequest(target);
    expect(request.path).toBe('a.go');
    expect(request).not.toHaveProperty('text');
    expect(JSON.stringify(request)).not.toContain('PRIVATE_FILE_BODY');
    if (target.file) expect(request).toEqual({ path: 'a.go', file: true });
    else if (!target.pr) expect(request).toMatchObject({ l1: target.l1, l2: target.l2 });
  }
  expect(explainRequest({ path: 'a.go', l1: 2, l2: 2, text: 'Run' })).toMatchObject({
    symbol: 'Run',
  });
});
