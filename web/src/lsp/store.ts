import type { Accessor } from 'solid-js';
import type { AppStore } from '../app/store.ts';
import type { Request } from '../lib/api.ts';
import type { DocTab, OpenOptions } from '../editor/types.ts';
import type { LspBrief } from '../editor/decode.ts';
import type { Target } from './logic.ts';
import type { SearchFields } from '../search/logic.ts';
import type { SearchReply, NavHit } from '../search/decode.ts';
import { decodeSearch } from '../search/decode.ts';
import { decodeLsp } from '../editor/decode.ts';
import {
  decodeServers,
  decodeSetup,
  decodeNavigation,
  decodeCalls,
  decodeDefinition,
} from './decode.ts';
import { isAbort, errorMessage } from '../lib/decode.ts';
interface LanguageState {
  menuOpen: boolean;
  pending: string;
  error: string;
  refs: Target | null;
  calls: Target | null;
  direction: string;
}
export interface LanguageOptions {
  request?: Request;
  post?: Request;
}
interface LanguageHost {
  store: AppStore;
  active: Accessor<
    | (Pick<DocTab, 'path' | 'cur' | 'total'> & {
        lsp?: Partial<LspBrief>;
        diffMode?: string | null;
      })
    | null
  >;
  actions: {
    wordAtCaret: () => Target | null;
    openFile: (path: string, options?: OpenOptions) => Promise<unknown>;
    searchWorkspace: (query: string, patch?: Partial<SearchFields>) => void;
    setSearchResults: (result: SearchReply) => void;
  };
}
import { createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, apiPost } from '../lib/api.ts';
import { createResourceRequest } from '../lib/resource-request.ts';
import { createSymbolActions } from '../editor/symbols.ts';
import { groupHits } from '../search/logic.ts';
import { positionNow, canAskServer } from './logic.ts';

function initialState(): LanguageState {
  return { menuOpen: false, pending: '', error: '', refs: null, calls: null, direction: 'in' };
}
export function createLanguageStore(
  editor: LanguageHost,
  options: LanguageOptions = {},
): ReturnType<typeof buildLanguageStore> {
  return buildLanguageStore(editor, options);
}
function buildLanguageStore(editor: LanguageHost, options: LanguageOptions = {}) {
  const app = editor.store;
  const request = options.request || api;
  const post = options.post || apiPost;
  const [state, set] = createStore(initialState());
  const [serverKey, setServerKey] = createSignal(0);
  const [setupKey, setSetupKey] = createSignal(0);
  const controllers = new Set<AbortController>();
  const installing = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let definitionController: AbortController | undefined;
  const serverRequest = createResourceRequest(request);
  const setupRequest = createResourceRequest(request);
  const refsRequest = createResourceRequest(request);
  const callsRequest = createResourceRequest(request);
  const symbols = createSymbolActions(app, {
    request,
    acceptLsp: (reply) => app.actions.acceptLspReply(reply),
  });
  const at = (arg?: string | Target): Target | null =>
    typeof arg === 'object' && arg.word
      ? arg
      : positionNow(
          editor.active(),
          app.state.navigation,
          typeof arg === 'string' ? arg : app.state.navigation.lastWord,
        ) || editor.actions.wordAtCaret();
  function scheduleInstallRefresh() {
    clearTimeout(timer);
    if (!disposed && installing.size)
      timer = setTimeout(() => {
        setServerKey((value) => value + 1);
        setSetupKey((value) => value + 1);
      }, 1000);
  }
  const [servers] = createResource(
    () => (app.state.workspace.meta ? serverKey() : false),
    async () => {
      try {
        const result = decodeServers(await serverRequest('api/lsp/servers'));
        if (disposed) return result;
        app.actions.acceptLspServers(result);
        for (const server of result.servers || []) {
          if (installing.has(server.name) && server.installed && server.state !== 'installing') {
            installing.delete(server.name);
            await post('api/lsp/start', { server: server.name });
            setServerKey((value) => value + 1);
          } else if (installing.has(server.name) && server.error) installing.delete(server.name);
        }
        scheduleInstallRefresh();
        return result;
      } catch (error) {
        if (!disposed && !isAbort(error)) set('error', errorMessage(error));
        return decodeServers({});
      }
    },
  );
  const [setup] = createResource(
    () =>
      app.state.layout.inspector === 'calls' && editor.active()
        ? { path: editor.active()?.path, revision: setupKey() }
        : false,
    async (key) => decodeSetup(await setupRequest('api/lsp/setup', { path: key.path })),
  );
  let warmController: AbortController | undefined;
  createResource(
    () => editor.active()?.path || false,
    async (path) => {
      warmController?.abort();
      warmController = new AbortController();
      const signal = warmController.signal;
      const document = editor.active();
      if (!document) return;
      if (document.lsp)
        app.actions.acceptLspReply({ ...document.lsp, state: document.lsp.state || 'off' }, path);
      if (['off', 'failed', 'ready'].includes(document.lsp?.state || 'off')) return document.lsp;
      for (let tries = 0; tries < 20 && !signal.aborted; tries++) {
        try {
          const result = decodeLsp(await request('api/lsp/warm', { path, wait: 1200 }, { signal }));
          if (disposed || signal.aborted || editor.active()?.path !== path) return;
          app.actions.acceptLspReply(result, path);
          if (!['starting', 'indexing'].includes(result.state)) return result;
        } catch (error) {
          if (!isAbort(error) && !disposed) set('error', errorMessage(error));
          return;
        }
      }
    },
  );
  async function loadSymbols(path = editor.active()?.path) {
    if (!path) return;
    await symbols.load(path);
    await symbols.upgrade(path);
    return app.state.documents.tabs.find((document) => document.path === path)?.outline || [];
  }
  const symbolKey = createMemo(() =>
    app.state.layout.inspector === 'symbols' && editor.active()
      ? { path: editor.active()?.path, state: editor.active()?.lsp?.state }
      : false,
  );
  const [symbolResource] = createResource(symbolKey, (key) => loadSymbols(key.path));
  const [references] = createResource(
    () => (state.refs ? { ...state.refs } : false),
    async (target) => {
      if (canAskServer(target, app.state.lsp.state)) {
        const result = decodeNavigation(
          await refsRequest('api/lsp/refs', { ...target, wait: 30000 }),
        );
        if (result.hits?.length)
          return {
            results: groupHits(result.hits),
            header: `${result.hits.length} references · ${result.server || 'LSP'}`,
          };
      }
      return decodeSearch(
        await refsRequest('api/search', { q: target.word, word: true, case: true }),
      );
    },
  );
  const [calls] = createResource(
    () => (state.calls ? { ...state.calls } : false),
    async (key) => decodeCalls(await callsRequest('api/lsp/calls', { ...key, wait: 30000 })),
  );
  async function lspAction(
    kind: string,
    params: { server?: string; option?: number; path?: string } = {},
  ): Promise<void> {
    if (state.pending) return;
    const controller = new AbortController();
    controllers.add(controller);
    set({ pending: kind, error: '' });
    try {
      const result = decodeLsp(
        await post('api/lsp/' + kind, params, { signal: controller.signal }),
      );
      if (disposed) return;
      if (result.state) app.actions.acceptLspReply(result, editor.active()?.path);
      if (kind === 'stop') app.actions.patchLsp('state', 'off');
      if (kind === 'install' && params.server) installing.add(params.server);
      setServerKey((value) => value + 1);
      setSetupKey((value) => value + 1);
      scheduleInstallRefresh();
    } catch (error) {
      if (!disposed && !isAbort(error)) set('error', errorMessage(error));
    } finally {
      controllers.delete(controller);
      if (!disposed) set('pending', '');
    }
  }
  function flashFind(query: string): void {
    const document = editor.active();
    if (document)
      app.actions.setNavigation({
        occurrence: query,
        reference: { path: document.path, l1: document.cur, l2: document.cur },
      });
  }
  async function gotoDefinition(
    arg?: string | Target,
    opts: { view?: string } = {},
  ): Promise<void> {
    const source = editor.active(),
      target = at(arg);
    if (!source || !target) return;
    definitionController?.abort();
    definitionController = new AbortController();
    const signal = definitionController.signal;
    set({ pending: 'definition', error: '' });
    try {
      let hits: NavHit[] | undefined;
      let server: string | undefined;
      if (canAskServer(target, app.state.lsp.state)) {
        const result = decodeNavigation(
          await request(
            'api/lsp/def',
            { path: source.path, line: target.line, col: target.col, wait: 5000 },
            { signal },
          ),
        );
        hits = result.hits;
        server = result.server;
      }
      if (!hits?.length) {
        const result = decodeDefinition(
          await request('api/def', { sym: target.word, path: source.path }, { signal }),
        );
        hits = result.defs;
        if (result.lsp) app.actions.acceptLspReply(result.lsp, source.path);
      }
      if (disposed || signal.aborted || editor.active()?.path !== source.path) return;
      const first = hits?.[0];
      if (hits?.length === 1 && first) {
        app.actions.pushHistory(source.path, source.cur);
        await editor.actions.openFile(first.path, {
          line: first.line,
          view: opts.view || (source.diffMode ? 'diff' : 'source'),
          soft: !opts.view,
        });
        flashFind(first.mid || target.word);
      } else if (hits?.length) {
        editor.actions.setSearchResults({
          results: groupHits(hits),
          header: `${hits.length} definitions · ${server || 'text match'}`,
        });
        app.actions.showRightInspector('search');
      } else {
        editor.actions.searchWorkspace(target.word, { word: true });
        app.actions.showRightInspector('search');
      }
    } catch (error) {
      if (!disposed && !isAbort(error)) set('error', errorMessage(error));
    } finally {
      if (!disposed && !signal.aborted) set('pending', '');
    }
  }
  onCleanup(() => {
    disposed = true;
    definitionController?.abort();
    warmController?.abort();
    clearTimeout(timer);
    symbols.dispose();
    for (const controller of controllers) controller.abort();
  });
  return {
    state,
    servers,
    setup,
    references,
    calls,
    symbols: symbolResource,
    actions: {
      loadSymbols,
      gotoDefinition,
      flashFind,
      findReferences(arg?: string | Target): void {
        const target = at(arg);
        if (!target) return;
        set('refs', { ...target, path: editor.active()?.path });
        app.actions.showRightInspector('refs');
      },
      showCalls(arg?: string | Target): void {
        const target = at(arg);
        app.actions.showRightInspector('calls');
        if (target && !target.imprecise) set('calls', { ...target, path: editor.active()?.path });
      },
      setCallDirection: (direction: string) => set('direction', direction),
      setLspMenuOpen(open: boolean): void {
        set('menuOpen', open);
        if (open) setServerKey((value) => value + 1);
      },
      openLspMenu() {
        set('menuOpen', true);
        setServerKey((value) => value + 1);
      },
      refreshLspMenu: () => setServerKey((value) => value + 1),
      startAllLsp: () => lspAction('start', { server: 'all' }),
      stopAllLsp: () => lspAction('stop'),
      runLspAction: lspAction,
      cancelSymbols: symbols.cancel,
    },
  };
}
