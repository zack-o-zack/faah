import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('app and holding template use only the approved icon sets', () => {
  const sources = [
    ...readdirSync('web/src', { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `${entry.parentPath}/${entry.name}`),
    'internal/workbench/workbench.go',
  ];
  const foreignClasses = sources.flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/icon-\\*\[([a-z0-9-]+)--/g)]
      .filter((match) => match[1] !== 'ph' && match[1] !== 'simple-icons')
      .map((match) => `${path}: ${match[0]}`),
  );
  expect(foreignClasses).toEqual([]);
});
