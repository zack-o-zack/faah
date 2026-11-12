import { createRoot, createSignal, Show } from 'solid-js';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { afterEach, test, expect, vi } from 'vitest';
import { createAppStore } from '../app/store.js';
import { EditorProvider } from '../editor/context.jsx';
import { ThemeProvider } from '../lib/theme-context.jsx';
import { createViewerResource } from './resource.js';
import { viewMode, previewKind, blockIndex } from './view.js';
import { TableViewer } from './TableViewer.jsx';
import { PreviewContent } from './PreviewContent.jsx';
import { ImageViewer } from './ImageViewer.jsx';
import { ExplainOrb } from './ExplainOrb.jsx';
import { MermaidDiagram } from './MermaidDiagram.jsx';
import { renderDiagram } from './mermaid-runtime.js';
import { DiffRows } from './DiffRows.jsx';
import { diffSelection } from './diff-selection.js';
import { api } from '../lib/api.js';
vi.mock('./mermaid-runtime.js', () => ({
  renderDiagram: vi.fn(
    async () => '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>',
  ),
}));
vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiPostJson: vi.fn() }));
const disposers = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});
function store() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return createAppStore({
      fetcher: async () => ({ lines: ['line'], total: 10, size: 100, exact: true }),
    });
  });
}
const theme = { current: () => 'light' };
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

test('view capability derives from path and each tab remembers its chosen view', async () => {
  const app = store();
  await app.actions.openDocument('one.md');
  const first = app.activeDocument();
  expect(viewMode(first)).toBe('markdown');
  app.viewerActions.togglePreview(first, 7);
  expect(viewMode(first)).toBe('source');
  await app.actions.openDocument('two.csv');
  expect(viewMode(app.activeDocument())).toBe('table');
  app.actions.activateDocument(0);
  expect(viewMode(app.activeDocument())).toBe('source');
  expect(previewKind({ path: 'docs/note.MD' })).toBe('markdown');
  expect(blockIndex([1, 10, 30], 20)).toBe(1);
  app.actions.closeDocument(0);
  app.viewerActions.setView(first, 'markdown');
  expect(app.state.documents.tabs[0].path).toBe('two.csv');
});
test('image state persists through switches and detached documents cannot update it', async () => {
  const app = store();
  await app.actions.openDocument('icon.png');
  const doc = app.activeDocument();
  app.viewerActions.imageLoaded(doc, 32, 32);
  app.viewerActions.zoomImage(doc, 1, 0.5);
  app.viewerActions.updateImage(doc, { panX: 23, bg: 'light' });
  await app.actions.openDocument('other.md');
  app.actions.activateDocument(0);
  expect(app.activeDocument().image).toMatchObject({
    fit: false,
    scale: 0.625,
    panX: 23,
    bg: 'light',
    pixelated: true,
  });
  app.actions.closeDocument(0);
  await app.actions.openDocument('icon.png');
  app.viewerActions.updateImage(doc, { panX: 1000 });
  expect(app.activeDocument().image.panX).toBe(0);
});
test('resource drops stale path/ref responses and aborts requests on replacement and disposal', async () => {
  const pending = [];
  api.mockImplementation(
    (endpoint, params, options) =>
      new Promise((resolve) => pending.push({ params, options, resolve })),
  );
  let change;
  function Harness() {
    const [document, set] = createSignal({ path: 'same.md', diffRef: 'old' });
    change = set;
    const [value] = createViewerResource(
      { store: { buffers: new Map(), bufferRevision: () => 0 } },
      document,
      'api/markdown',
    );
    return (
      <Show when={!value.loading}>
        <span>{value()?.html}</span>
      </Show>
    );
  }
  const mounted = render(() => <Harness />);
  change({ path: 'same.md', diffRef: 'new' });
  expect(pending[0].options.signal.aborted).toBe(true);
  pending[1].resolve({ html: 'new content' });
  await screen.findByText('new content');
  pending[0].resolve({ html: 'obsolete content' });
  await Promise.resolve();
  expect(screen.queryByText('obsolete content')).toBeNull();
  change({ path: 'other.md', diffRef: '' });
  mounted.unmount();
  expect(pending[2].options.signal.aborted).toBe(true);
});
test('table escapes cells, pads missing values, caps rows and jumps to source', async () => {
  const jump = vi.fn();
  const rows = Array.from({ length: 1002 }, (_, i) => ({
    line: i + 2,
    cells: ['<script>literal</script>'],
  }));
  render(() => (
    <TableViewer
      data={{ cols: 2, headerLine: 1, header: ['first', 'last'], rows, truncated: true }}
      document={{ total: 20001 }}
      jump={jump}
    />
  ));
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1000);
  expect(document.querySelectorAll('script')).toHaveLength(0);
  expect(document.querySelector('td.miss')).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', { name: 'Open source line 2' }));
  expect(jump).toHaveBeenCalledWith(2);
  await fireEvent.keyDown(screen.getByRole('button', { name: 'Open source line 3' }), {
    key: 'Enter',
  });
  expect(jump).toHaveBeenLastCalledWith(3);
  expect(screen.getByText(/Showing the first/).textContent).toContain('20,001');
});
test('markdown postprocessing owns find, copy, selection and cleanup', async () => {
  const app = store();
  await app.actions.openDocument('readme.md');
  const editor = {
    store: app,
    services: {},
    active: app.activeDocument,
    ui: {},
    actions: { setSelection: vi.fn() },
  };
  const mounted = render(() => (
    <EditorProvider value={editor}>
      <ThemeProvider store={theme}>
        <PreviewContent
          document={app.activeDocument()}
          kind="markdown"
          data={{
            html: '<h1 id="title" data-line="1">Title</h1><p data-line="4">Hello world</p><pre data-lang="js"><code>const a = 1;</code></pre><script>alert(1)</script>',
          }}
        />
      </ThemeProvider>
    </EditorProvider>
  ));
  expect(document.querySelector('#md-title')).toBeTruthy();
  expect(document.querySelectorAll('script')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
  expect(editor.services.preview.find('world', false)).toEqual([{ line: 4 }]);
  expect(document.querySelector('mark').textContent).toBe('world');
  editor.services.preview.clearMarks();
  expect(document.querySelector('mark')).toBeNull();
  const service = editor.services.preview;
  mounted.unmount();
  expect(editor.services.preview).toBeUndefined();
  expect(service).toBeTruthy();
});
test('image controls update state and release pointer and wheel listeners', async () => {
  const app = store();
  await app.actions.openDocument('icon.png');
  const editor = { store: app, services: {} };
  const mounted = render(() => (
    <EditorProvider value={editor}>
      <ImageViewer document={app.activeDocument()} />
    </EditorProvider>
  ));
  await fireEvent.click(screen.getByRole('button', { name: '1:1' }));
  expect(app.activeDocument().image).toMatchObject({ scale: 1, fit: false });
  await fireEvent.click(screen.getByRole('button', { name: 'Checker' }));
  expect(app.activeDocument().image.bg).toBe('dark');
  expect(editor.services.imageKey({ key: '+' })).toBe(true);
  expect(app.activeDocument().image.scale).toBe(1.25);
  mounted.unmount();
  expect(editor.services.imageKey).toBeUndefined();
});
test('explain orb renders progress, completion, sidebar suppression and dismissal', async () => {
  const app = store();
  const open = vi.fn();
  render(() => (
    <EditorProvider value={{ store: app, services: { openExplanation: open } }}>
      <ExplainOrb />
    </EditorProvider>
  ));
  expect(document.querySelector('#explain-orb')).toBeNull();
  app.viewerActions.orbBegin();
  expect(screen.getByRole('button', { name: 'Explaining' })).toBeTruthy();
  app.viewerActions.orbAttach({ id: 'thread', turns: [{ running: true, tools: ['Read source'] }] });
  app.viewerActions.orbThread({
    id: 'thread',
    turns: [{ running: false, reply: 'A clear answer.', notes: [{}] }],
  });
  expect(screen.getByText('A clear answer.')).toBeTruthy();
  await fireEvent.click(document.querySelector('#explain-orb-open'));
  expect(open).toHaveBeenCalledWith('thread');
  expect(document.querySelector('#explain-orb')).toBeNull();
});
test('long diff mounts only visible slots and releases recycled line numbers', async () => {
  const app = store();
  await app.actions.openDocument('large.js');
  let scroll;
  function Harness() {
    const [top, setTop] = createSignal(0);
    scroll = setTop;
    return (
      <EditorProvider value={{ store: app }}>
        <DiffRows
          hunk={{
            rows: Array.from({ length: 20000 }, (_, i) => ({
              type: 'add',
              newLine: i + 1,
              text: 'line ' + (i + 1),
            })),
          }}
          document={app.activeDocument()}
          mode="unified"
          diagnostics={new Map()}
          top={top()}
          height={900}
        />
      </EditorProvider>
    );
  }
  render(() => <Harness />);
  expect(document.querySelectorAll('.diff-row').length).toBeLessThan(100);
  scroll(200000);
  await waitFor(() => expect(document.querySelector('[data-l="10001"]')).toBeTruthy());
  expect(document.querySelector('[data-l="1"]')).toBeNull();
});
test('diff selections exclude gutters, deduplicate split context and anchor deletions', () => {
  const root = document.createElement('div');
  // A server-independent DOM fixture exercises the browser Range contract.
  root.innerHTML =
    '<div data-l="4"><div class="diff-ln">4</div><div class="diff-code">context</div></div><div data-l="4"><div class="diff-code">context</div></div><div data-at="5" data-old-l="6"><div class="diff-code">deleted</div></div>';
  document.body.append(root);
  const range = document.createRange();
  range.selectNodeContents(root);
  expect(diffSelection(root, range, { path: 'x', total: 10 })).toMatchObject({
    text: 'context\ndeleted',
    l1: 4,
    l2: 4,
    side: 'RIGHT',
  });
  range.selectNodeContents(root.lastChild);
  expect(diffSelection(root, range, { path: 'x', total: 10 })).toMatchObject({
    text: 'deleted',
    l1: 4,
    l2: 5,
    side: 'LEFT',
    delL1: 6,
    delL2: 6,
  });
  root.remove();
});

test('Mermaid follows theme resources and exposes an owned exit operation without redispatching keys', async () => {
  const editor = { services: {} };
  let changeTheme;
  function Harness() {
    const [current, setTheme] = createSignal('light');
    changeTheme = setTheme;
    return (
      <EditorProvider value={editor}>
        <ThemeProvider store={{ current }}>
          <MermaidDiagram source="graph TD; A-->B" />
        </ThemeProvider>
      </EditorProvider>
    );
  }
  const mounted = render(() => <Harness />);
  await waitFor(() => expect(document.querySelector('.md-mermaid svg')).toBeTruthy());
  await fireEvent.click(screen.getByRole('button', { name: 'Toggle diagram fullscreen' }));
  const exit = [...editor.services.diagramFullscreens][0];
  expect(exit()).toBe(true);
  expect(exit()).toBe(false);
  expect(document.querySelector('.md-mermaid.is-fullscreen')).toBeNull();
  changeTheme('dark');
  await waitFor(() => expect(renderDiagram).toHaveBeenLastCalledWith('graph TD; A-->B', 'dark'));
  mounted.unmount();
  expect(editor.services.diagramFullscreens.size).toBe(0);
});

test('viewer resources refetch on buffer generations while ignoring ordinary chunk publications', async () => {
  api.mockResolvedValue({ html: 'generation content' });
  let publish;
  let reset;
  function Harness() {
    const [revision, setRevision] = createSignal(0);
    let generation = 0;
    const buffer = {
      revision,
      get generation() {
        return generation;
      },
    };
    publish = () => setRevision((n) => n + 1);
    reset = () => {
      generation++;
      publish();
    };
    const [data] = createViewerResource(
      { store: { buffers: new Map([['file.md', buffer]]), bufferRevision: () => 0 } },
      () => ({ path: 'file.md' }),
      'api/markdown',
    );
    return (
      <Show when={!data.loading}>
        <p>{data()?.html}</p>
      </Show>
    );
  }
  const before = api.mock.calls.length;
  render(() => <Harness />);
  await screen.findByText('generation content');
  publish();
  expect(api.mock.calls.length).toBe(before + 1);
  reset();
  await waitFor(() => expect(api.mock.calls.length).toBe(before + 2));
});

test('Mermaid failures show the source and error without reading a failed resource', async () => {
  renderDiagram.mockRejectedValueOnce(new Error('Invalid diagram'));
  render(() => (
    <EditorProvider value={{ services: {} }}>
      <ThemeProvider store={{ current: () => 'light' }}>
        <MermaidDiagram source="invalid diagram source" />
      </ThemeProvider>
    </EditorProvider>
  ));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid diagram'));
  expect(screen.getByText('invalid diagram source')).toBeTruthy();
  expect(document.querySelector('.md-mermaid svg')).toBeNull();
});
