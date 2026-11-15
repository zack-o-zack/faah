/// <reference types="node" />
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore } from '../editor/store.ts';
import type { EditorStore } from '../editor/store.ts';
import { required } from '../lib/test-values.ts';
import { WalkthroughFile } from './WalkthroughFile.tsx';

// jsdom cannot compile Tailwind directives; load the authored diff rules for style checks.
const stylesheet = readFileSync('web/tailwind.css', 'utf8');
const diffStyles = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => /\.(?:diff-|review-diff-)/.test(match[1] || ''))
  .map((match) => match[0])
  .join('\n');

test.each(['unified', 'side-by-side'])(
  'walkthrough long lines use shared wrapping styles in %s layout',
  async (layout) => {
    const oldText = 'x'.repeat(2000);
    const newText = 'const message = "' + 'long message '.repeat(40) + '";';
    let editor: EditorStore | undefined;
    const view = render(() => {
      const app = createAppStore({ settings: { post: async (_, body) => ({ settings: body }) } });
      editor = createEditorStore(app, { review: { request: async () => ({ files: [] }) } });
      return (
        <EditorProvider value={editor}>
          <style>{diffStyles}</style>
          <WalkthroughFile
            file={{
              path: 'long-lines.ts',
              group: 'core',
              additions: 1,
              deletions: 1,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  rows: [
                    { type: 'del', oldLine: 1, text: oldText },
                    { type: 'add', newLine: 1, text: newText },
                    { type: 'ctx', oldLine: 2, newLine: 2, text: 'next line' },
                  ],
                },
              ],
            }}
          />
        </EditorProvider>
      );
    });
    await required(editor).settings.actions.setSetting(
      'diffEditor.renderSideBySide',
      layout === 'side-by-side',
    );

    const rows = view.container.querySelectorAll('.review-diff-row');
    expect(rows).toHaveLength(layout === 'side-by-side' ? 4 : 3);
    for (const row of rows) {
      const code = required(row.lastElementChild);
      const style = getComputedStyle(code);
      expect(style.whiteSpace).toBe('pre-wrap');
      expect(style.wordBreak).toBe('break-word');
      expect(style.overflowWrap).toBe('anywhere');
      expect(style.minWidth).toBe('0px');
      expect(style.overflowX).toBe('visible');
      expect(code.classList.contains('diff-code')).toBe(true);
      expect(getComputedStyle(row).overflowX).toBe('visible');
    }
    expect(view.container.querySelector('.diff-type-del .diff-code')?.textContent).toBe(oldText);
    expect(view.container.querySelector('.diff-type-add .diff-code')?.textContent).toBe(newText);

    const pairs = view.container.querySelectorAll('.diff-row-pair');
    expect(pairs).toHaveLength(layout === 'side-by-side' ? 2 : 0);
    if (layout === 'side-by-side') {
      const first = required(pairs[0]);
      expect(getComputedStyle(first).display).toBe('flex');
      expect(first.children).toHaveLength(2);
      expect(first.querySelector('.diff-side-left .diff-code')?.textContent).toBe(oldText);
      expect(first.querySelector('.diff-side:not(.diff-side-left) .diff-code')?.textContent).toBe(
        newText,
      );
      expect(required(pairs[1]).querySelectorAll('.diff-type-ctx')).toHaveLength(2);
    }
  },
);
