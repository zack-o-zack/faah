import { createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, apiPost } from '../lib/api.ts';
import { createResourceRequest } from '../lib/resource-request.ts';
import { createSymbolActions } from '../editor/symbols.ts';
import { groupHits } from '../search/logic.js';
import { positionNow, canAskServer } from './logic.js';
/** @returns {{menuOpen:boolean,pending:string,error:string,refs:object|null,calls:object|null,direction:string}} */
function initialState() {
  return { menuOpen: false, pending: '', error: '', refs: null, calls: null, direction: 'in' };
}
export function createLanguageStore(editor, options = {}) {
  const app = editor.store;
  const request = options.request || api;
  const post = options.post || apiPost;
  const [state, set] = createStore(initialState());
  const [serverKey, setServerKey] = createSignal(0);
  const [setupKey, setSetupKey] = createSignal(0);
  const controllers = new Set();
  const installing = new Set();
  let timer,
    disposed = false,
    definitionController;
  const serverRequest = createResourceRequest(request);
  const setupRequest = createResourceRequest(request);
  const refsRequest = createResourceRequest(request);
  const callsRequest = createResourceRequest(request);
  const symbols = createSymbolActions(app, {
    request,
    acceptLsp: (reply) => app.actions.acceptLspReply(reply),
  });
  const at = (arg) =>
    arg?.word
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
        const result = await serverRequest('api/lsp/servers');
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
        if (!disposed && error.name !== 'AbortError') set('error', error.message);
        return { servers: [] };
      }
    },
  );
  const [setup] = createResource(
    () =>
      app.state.layout.inspector === 'calls' && editor.active()
        ? { path: editor.active().path, revision: setupKey() }
        : false,
    (key) => setupRequest('api/lsp/setup', { path: key.path }),
  );
  let warmController;
  createResource(
    () => editor.active()?.path || false,
    async (path) => {
      warmController?.abort();
      warmController = new AbortController();
      const signal = warmController.signal;
      const document = editor.active();
      if (document.lsp) app.actions.acceptLspReply(document.lsp, path);
      if (['off', 'failed', 'ready'].includes(document.lsp?.state || 'off')) return document.lsp;
      for (let tries = 0; tries < 20 && !signal.aborted; tries++) {
        try {
          const result = await request('api/lsp/warm', { path, wait: 1200 }, { signal });
          if (disposed || signal.aborted || editor.active()?.path !== path) return;
          app.actions.acceptLspReply(result, path);
          if (!['starting', 'indexing'].includes(result.state)) return result;
        } catch (error) {
          if (error.name !== 'AbortError' && !disposed) set('error', error.message);
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
      ? { path: editor.active().path, state: editor.active().lsp?.state }
      : false,
  );
  const [symbolResource] = createResource(symbolKey, (key) => loadSymbols(key.path));
  const [references] = createResource(
    () => (state.refs ? { ...state.refs } : false),
    async (target) => {
      if (canAskServer(target, app.state.lsp.state)) {
        const result = await refsRequest('api/lsp/refs', { ...target, wait: 30000 });
        if (result.hits?.length)
          return {
            results: groupHits(result.hits),
            header: `${result.hits.length} references · ${result.server || 'LSP'}`,
          };
      }
      return refsRequest('api/search', { q: target.word, word: true, case: true });
    },
  );
  const [calls] = createResource(
    () => (state.calls ? { ...state.calls } : false),
    (key) => callsRequest('api/lsp/calls', { ...key, wait: 30000 }),
  );
  async function lspAction(kind, params = {}) {
    if (state.pending) return;
    const controller = new AbortController();
    controllers.add(controller);
    set({ pending: kind, error: '' });
    try {
      const result = await post('api/lsp/' + kind, params, { signal: controller.signal });
      if (disposed) return;
      if (result.state) app.actions.acceptLspReply(result, editor.active()?.path);
      if (kind === 'stop') app.actions.patchLsp('state', 'off');
      if (kind === 'install') installing.add(params.server);
      setServerKey((value) => value + 1);
      setSetupKey((value) => value + 1);
      scheduleInstallRefresh();
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
    } finally {
      controllers.delete(controller);
      if (!disposed) set('pending', '');
    }
  }
  function flashFind(query) {
    const document = editor.active();
    if (document)
      app.actions.setNavigation({
        occurrence: query,
        reference: { path: document.path, l1: document.cur, l2: document.cur },
      });
  }
  async function gotoDefinition(arg, opts = {}) {
    const source = editor.active(),
      target = at(arg);
    if (!source || !target) return;
    definitionController?.abort();
    definitionController = new AbortController();
    const signal = definitionController.signal;
    set({ pending: 'definition', error: '' });
    try {
      let hits, server;
      if (canAskServer(target, app.state.lsp.state)) {
        const result = await request(
          'api/lsp/def',
          { path: source.path, line: target.line, col: target.col, wait: 5000 },
          { signal },
        );
        hits = result.hits;
        server = result.server;
      }
      if (!hits?.length) {
        const result = await request(
          'api/def',
          { sym: target.word, path: source.path },
          { signal },
        );
        hits = result.defs;
        if (result.lsp) app.actions.acceptLspReply(result.lsp, source.path);
      }
      if (disposed || signal.aborted || editor.active()?.path !== source.path) return;
      if (hits?.length === 1) {
        app.actions.pushHistory(source.path, source.cur);
        await editor.actions.openFile(hits[0].path, {
          line: hits[0].line,
          view: opts.view || (source.diffMode ? 'diff' : 'source'),
          soft: !opts.view,
        });
        flashFind(hits[0].mid || target.word);
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
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
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
      findReferences(arg) {
        const target = at(arg);
        if (!target) return;
        set('refs', { ...target, path: editor.active().path });
        app.actions.showRightInspector('refs');
      },
      showCalls(arg) {
        const target = at(arg);
        app.actions.showRightInspector('calls');
        if (target && !target.imprecise) set('calls', { ...target, path: editor.active().path });
      },
      setCallDirection: (direction) => set('direction', direction),
      setLspMenuOpen(open) {
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
