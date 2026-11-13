import type * as MarkdownDOM from './markdown-dom.ts';
import type { Setter } from 'solid-js';
import type { DocTab } from '../editor/types.ts';
import type { RequestOptions } from '../lib/api.ts';
import { createEditorStore } from '../editor/store.ts';
import { testDocument } from '../editor/test-document.ts';
import { required } from '../lib/test-values.ts';
import { decodeMarkdown } from './decode.ts';
import { decodeThread } from '../threads/decode.ts';
import type { ThemeStore } from '../lib/theme.ts';
import { createRoot, createSignal, Show } from 'solid-js';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { afterEach, test, expect, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { ThemeProvider } from '../lib/theme-context.tsx';
import { createViewerResource } from './resource.ts';
import { viewMode, previewKind, blockIndex } from './view.ts';
import { TableViewer } from './TableViewer.tsx';
import { PreviewContent } from './PreviewContent.tsx';
import { ImageViewer } from './ImageViewer.tsx';
import { ExplainOrb } from './ExplainOrb.tsx';
import { MermaidDiagram } from './MermaidDiagram.tsx';
import { renderDiagram } from './mermaid-runtime.ts';
import { DiffRows } from './DiffRows.tsx';
import { diffSelection } from './diff-selection.ts';
import { api } from '../lib/api.ts';
import { sanitizeHTML } from './markdown-dom.ts';
vi.mock('./markdown-dom.ts', async (original) => {
  const actual = await original<typeof MarkdownDOM>();
  return { ...actual, sanitizeHTML: vi.fn(actual.sanitizeHTML) };
});
vi.mock('./mermaid-runtime.ts', () => ({
  renderDiagram: vi.fn(
    async () => '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>',
  ),
}));
vi.mock('../lib/api.ts', () => ({ api: vi.fn(), apiPost: vi.fn(), apiPostJson: vi.fn() }));
const disposers: (() => void)[] = [];
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
const theme: ThemeStore = {
  current: () => 'light',
  preference: () => 'light',
  themes: () => [],
  setTheme: () => true,
};
function editorStore(app = store()) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return createEditorStore(app);
  });
}
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
  app.actions.togglePreview(first, 7);
  expect(viewMode(first)).toBe('source');
  await app.actions.openDocument('two.csv');
  expect(viewMode(app.activeDocument())).toBe('table');
  app.actions.activateDocument(0);
  expect(viewMode(app.activeDocument())).toBe('source');
  expect(previewKind({ path: 'docs/note.MD' })).toBe('markdown');
  expect(blockIndex([1, 10, 30], 20)).toBe(1);
  app.actions.closeDocument(0);
  app.actions.setView(first, 'markdown');
  expect(required(app.state.documents.tabs[0]).path).toBe('two.csv');
});
test('image state persists through switches and detached documents cannot update it', async () => {
  const app = store();
  await app.actions.openDocument('icon.png');
  const doc = required(app.activeDocument());
  app.actions.imageLoaded(doc, 32, 32);
  app.actions.zoomImage(doc, 1, 0.5);
  app.actions.updateImage(doc, { panX: 23, bg: 'light' });
  await app.actions.openDocument('other.md');
  app.actions.activateDocument(0);
  expect(required(app.activeDocument()).image).toMatchObject({
    fit: false,
    scale: 0.625,
    panX: 23,
    bg: 'light',
    pixelated: true,
  });
  app.actions.closeDocument(0);
  await app.actions.openDocument('icon.png');
  app.actions.updateImage(doc, { panX: 1000 });
  expect(required(app.activeDocument()).image.panX).toBe(0);
});
test('resource drops stale path/ref responses and aborts requests on replacement and disposal', async () => {
  const pending: {
    params: unknown;
    options?: RequestOptions;
    resolve: (value: unknown) => void;
  }[] = [];
  vi.mocked(api).mockImplementation(
    (_endpoint, params, options) =>
      new Promise<unknown>((resolve) => pending.push({ params, options, resolve })),
  );
  let change: Setter<DocTab> | undefined;
  function Harness() {
    const [document, set] = createSignal(testDocument({ path: 'same.md', diffRef: 'old' }));
    change = set;
    const [value] = createViewerResource(
      { store: { buffers: new Map(), bufferRevision: () => 0 } },
      document,
      'api/markdown',
      decodeMarkdown,
    );
    return (
      <Show when={!value.loading}>
        <span>{value()?.html}</span>
      </Show>
    );
  }
  const mounted = render(() => <Harness />);
  required(change)(testDocument({ path: 'same.md', diffRef: 'new' }));
  expect(required(required(pending[0]).options?.signal).aborted).toBe(true);
  required(pending[1]).resolve({ html: 'new content' });
  await screen.findByText('new content');
  required(pending[0]).resolve({ html: 'obsolete content' });
  await Promise.resolve();
  expect(screen.queryByText('obsolete content')).toBeNull();
  required(change)(testDocument({ path: 'other.md', diffRef: '' }));
  mounted.unmount();
  expect(required(required(pending[2]).options?.signal).aborted).toBe(true);
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
      document={testDocument({ total: 20001 })}
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
  const base = editorStore(app);
  const editor = { ...base, actions: { ...base.actions, setSelection: vi.fn() } };
  const mounted = render(() => (
    <EditorProvider value={editor}>
      <ThemeProvider store={theme}>
        <PreviewContent
          document={required(app.activeDocument())}
          kind="markdown"
          data={{
            path: 'readme.md',
            html: '<h1 id="title" data-line="1">Title</h1><p data-line="4">Hello world</p><pre data-lang="js"><code>const a = 1;</code></pre><script>alert(1)</script>',
          }}
        />
      </ThemeProvider>
    </EditorProvider>
  ));
  expect(document.querySelector('#md-title')).toBeTruthy();
  expect(document.querySelectorAll('script')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
  expect(required(editor.services.preview).find('world', false)).toEqual([{ line: 4 }]);
  expect(required(document.querySelector<HTMLElement>('mark')).textContent).toBe('world');
  required(editor.services.preview).clearMarks();
  expect(document.querySelector('mark')).toBeNull();
  const service = editor.services.preview;
  mounted.unmount();
  expect(editor.services.preview).toBeUndefined();
  expect(service).toBeTruthy();
});
test('image controls update state and release pointer and wheel listeners', async () => {
  const app = store();
  await app.actions.openDocument('icon.png');
  const editor = editorStore(app);
  const mounted = render(() => (
    <EditorProvider value={editor}>
      <ImageViewer document={required(app.activeDocument())} />
    </EditorProvider>
  ));
  await fireEvent.click(screen.getByRole('button', { name: '1:1' }));
  expect(required(app.activeDocument()).image).toMatchObject({ scale: 1, fit: false });
  await fireEvent.click(screen.getByRole('button', { name: 'Checker' }));
  expect(required(app.activeDocument()).image.bg).toBe('dark');
  expect(required(editor.services.imageKey)(new KeyboardEvent('keydown', { key: '+' }))).toBe(true);
  expect(required(app.activeDocument()).image.scale).toBe(1.25);
  mounted.unmount();
  expect(editor.services.imageKey).toBeUndefined();
});
test('explain orb renders progress, completion, sidebar suppression and dismissal', async () => {
  const app = store();
  const open = vi.fn();
  const base = editorStore(app);
  render(() => (
    <EditorProvider
      value={{
        ...base,
        actions: { ...base.actions, openThread: open },
      }}
    >
      <ExplainOrb />
    </EditorProvider>
  ));
  expect(document.querySelector('#explain-orb')).toBeNull();
  app.actions.orbBegin();
  expect(screen.getByRole('button', { name: 'Explaining' })).toBeTruthy();
  app.actions.orbAttach(
    decodeThread({ id: 'thread', turns: [{ running: true, tools: ['Read source'] }] }),
  );
  app.actions.orbThread(
    decodeThread({
      id: 'thread',
      turns: [{ running: false, reply: 'A clear answer.', notes: [{}] }],
    }),
  );
  expect(screen.getByText('A clear answer.')).toBeTruthy();
  await fireEvent.click(required(document.querySelector('#explain-orb-open')));
  expect(open).toHaveBeenCalledWith('thread');
  expect(document.querySelector('#explain-orb')).toBeNull();
});
test('long diff mounts only visible slots and releases recycled line numbers', async () => {
  const app = store();
  await app.actions.openDocument('large.js');
  let scroll: Setter<number> | undefined;
  function Harness() {
    const [top, setTop] = createSignal(0);
    scroll = setTop;
    return (
      <EditorProvider value={editorStore(app)}>
        <DiffRows
          hunk={{
            oldStart: 0,
            newStart: 1,
            section: '',
            rows: Array.from({ length: 20000 }, (_, i) => ({
              type: 'add',
              newLine: i + 1,
              text: 'line ' + (i + 1),
            })),
          }}
          document={required(app.activeDocument())}
          jump={() => {}}
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
  required(scroll)(200000);
  await waitFor(() => expect(document.querySelector('[data-l="10001"]')).toBeTruthy());
  expect(document.querySelector('[data-l="1"]')).toBeNull();
});
test('diff selections exclude gutters, deduplicate split context and anchor deletions', () => {
  const root = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- A static DOM fixture exercises the browser Range contract.
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
  range.selectNodeContents(required(root.lastChild));
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
  const editor = editorStore();
  let changeTheme: Setter<string> | undefined;
  function Harness() {
    const [current, setTheme] = createSignal('light');
    changeTheme = setTheme;
    return (
      <EditorProvider value={editor}>
        <ThemeProvider store={{ ...theme, current }}>
          <MermaidDiagram source="graph TD; A-->B" />
        </ThemeProvider>
      </EditorProvider>
    );
  }
  const mounted = render(() => <Harness />);
  await waitFor(() => expect(document.querySelector('.md-mermaid svg')).toBeTruthy());
  await fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  const exit = [...required(editor.services.diagramFullscreens)][0];
  expect(required(exit)()).toBe(true);
  expect(required(exit)()).toBe(false);
  expect(document.querySelector('.md-mermaid.is-fullscreen')).toBeNull();
  required(changeTheme)('dark');
  await waitFor(() => expect(renderDiagram).toHaveBeenLastCalledWith('graph TD; A-->B', 'dark'));
  mounted.unmount();
  expect(required(editor.services.diagramFullscreens).size).toBe(0);
});

test('viewer resources refetch on buffer generations while ignoring ordinary chunk publications', async () => {
  vi.mocked(api).mockResolvedValue({ html: 'generation content' });
  let publish: (() => number) | undefined;
  let reset: (() => void) | undefined;
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
      setRevision((n) => n + 1);
    };
    const [data] = createViewerResource(
      { store: { buffers: new Map([['file.md', buffer]]), bufferRevision: () => 0 } },
      () => testDocument({ path: 'file.md' }),
      'api/markdown',
      decodeMarkdown,
    );
    return (
      <Show when={!data.loading}>
        <p>{data()?.html}</p>
      </Show>
    );
  }
  const before = vi.mocked(api).mock.calls.length;
  render(() => <Harness />);
  await screen.findByText('generation content');
  required(publish)();
  expect(vi.mocked(api).mock.calls.length).toBe(before + 1);
  required(reset)();
  await waitFor(() => expect(vi.mocked(api).mock.calls.length).toBe(before + 2));
});

test('Mermaid failures show the source and error without reading a failed resource', async () => {
  vi.mocked(renderDiagram).mockRejectedValueOnce(new Error('Invalid diagram'));
  render(() => (
    <EditorProvider value={editorStore()}>
      <ThemeProvider store={theme}>
        <MermaidDiagram source="invalid diagram source" />
      </ThemeProvider>
    </EditorProvider>
  ));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid diagram'));
  expect(screen.getByText('invalid diagram source')).toBeTruthy();
  expect(document.querySelector('.md-mermaid svg')).toBeNull();
});

test('sanitization depends on content and path, not theme or scroll targets', async () => {
  const app = store();
  await app.actions.openDocument('readme.md');
  const [data, setData] = createSignal({ path: 'readme.md', html: '<p>Memoized content</p>' });
  const [current, setCurrent] = createSignal('light');
  vi.mocked(sanitizeHTML).mockClear();
  render(() => (
    <EditorProvider value={editorStore(app)}>
      <ThemeProvider store={{ ...theme, current }}>
        <PreviewContent document={required(app.activeDocument())} kind="markdown" data={data()} />
      </ThemeProvider>
    </EditorProvider>
  ));
  expect(sanitizeHTML).toHaveBeenCalledTimes(1);
  setCurrent('dark');
  app.actions.requestAnchor(required(app.activeDocument()), 'missing');
  expect(sanitizeHTML).toHaveBeenCalledTimes(1);
  setData({ path: 'readme.md', html: '<p>Changed content</p>' });
  expect(sanitizeHTML).toHaveBeenCalledTimes(2);
});
