import { describe, expect, test } from 'vitest';
import { linkTarget, explainEvidenceLine, explainStaleLabel } from './threadrefs.js';

describe('linkTarget', () => {
  test('links anything path-shaped without refs', () => {
    expect(linkTarget(null, 'a.go:3-5', 'a.go', '3', '5')).toEqual({ path: 'a.go', line: 3, end: 5 });
    expect(linkTarget(null, 'a.go', 'a.go')).toEqual({ path: 'a.go', line: 0, end: 0 });
  });

  test('uses the checked line with refs', () => {
    const refs = { 'a.go:4': { line: 6 }, 'a.go:1-3': { line: 1, end: 3 }, 'a.go': {} };
    expect(linkTarget(refs, 'a.go:4', 'a.go', '4')).toEqual({ path: 'a.go', line: 6, end: 0 });
    expect(linkTarget(refs, 'a.go:1-3', 'a.go', '1', '3')).toEqual({ path: 'a.go', line: 1, end: 3 });
    expect(linkTarget(refs, 'a.go', 'a.go')).toEqual({ path: 'a.go', line: 0, end: 0 });
  });

  test('leaves an unchecked citation unlinked', () => {
    expect(linkTarget({}, 'a.go:99', 'a.go', '99')).toBeNull();
  });
});

describe('explainEvidenceLine', () => {
  test('language server evidence', () => {
    expect(explainEvidenceLine({ source: 'gopls', definition: true, refs: 14, refFiles: 5, callers: 3 }))
      .toBe('gopls · definition · 14 references in 5 files · 3 callers');
    expect(explainEvidenceLine({ source: 'gopls', definition: true, refs: 1, refFiles: 1, callers: 1 }))
      .toBe('gopls · definition · 1 reference in 1 file · 1 caller');
    expect(explainEvidenceLine({ source: 'gopls', identifiers: 8 })).toBe('gopls · 8 symbols resolved');
  });

  test('text evidence', () => {
    expect(explainEvidenceLine({ source: 'text', refs: 9, refFiles: 3 })).toBe('text match · 9 occurrences in 3 files');
    expect(explainEvidenceLine({ source: 'text' })).toBe('text match');
  });

  test('missing evidence', () => {
    expect(explainEvidenceLine(undefined)).toBe('');
  });
});

test('explainStaleLabel', () => {
  expect(explainStaleLabel('callers')).toBe('Callers changed');
  expect(explainStaleLabel('references')).toBe('References changed');
  expect(explainStaleLabel('reader')).toBe('Written for a different reader');
});
