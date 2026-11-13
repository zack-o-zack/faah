import { required } from '../lib/test-values.ts';
import { createEditorStore } from '../editor/store.ts';
import { createRoot } from 'solid-js';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { PanelHandle } from './PanelHandle.tsx';
import { DEFAULT_LAYOUT, readLayout } from './logic.ts';

test('invalid saved layout falls back and widths stay within supported limits', () => {
  expect(readLayout('{')).toEqual(DEFAULT_LAYOUT);
  expect(readLayout('null')).toEqual(DEFAULT_LAYOUT);
  expect(readLayout('{"leftWidth":9999,"rightWidth":1,"threadsWidth":"wide"}')).toMatchObject({
    leftWidth: 620,
    rightWidth: 200,
    threadsWidth: 384,
  });
  expect(readLayout('{"right":true,"threads":true}')).toMatchObject({
    right: true,
    threads: false,
  });
});

test('panel visibility, inspector choice and sizes persist in a fresh app', () => {
  createRoot((dispose) => {
    const app = createAppStore();
    app.actions.setPanelVisible('threads', true);
    app.actions.showRightInspector('search');
    app.actions.setPanelWidth('right', 450);
    app.actions.togglePanel('left');
    const next = createAppStore();
    expect(next.state.layout).toMatchObject({
      left: false,
      right: true,
      threads: false,
      rightWidth: 450,
      inspector: 'search',
    });
    dispose();
  });
});

test('resizers update persisted width by keyboard and pointer in each direction', () => {
  let app: ReturnType<typeof createAppStore> | undefined;
  render(() => {
    app = createAppStore();
    app.actions.setPanelVisible('right', true);
    return (
      <EditorProvider value={createEditorStore(app)}>
        <PanelHandle panel="left" label="Sidebar width" />
        <PanelHandle panel="right" label="Inspector width" />
      </EditorProvider>
    );
  });
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Sidebar width' }), {
    key: 'ArrowRight',
  });
  expect(required(app).state.layout.leftWidth).toBe(350);
  fireEvent.pointerDown(screen.getByRole('separator', { name: 'Inspector width' }), {
    button: 0,
    clientX: 900,
  });
  fireEvent.pointerMove(document, { clientX: 860 });
  fireEvent.pointerUp(document);
  expect(required(app).state.layout.rightWidth).toBe(424);
  expect(JSON.parse(localStorage.getItem('faah.layout') || '{}').rightWidth).toBe(424);
});
