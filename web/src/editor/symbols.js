import { api } from '../lib/api.ts';

export function createSymbolActions(
  store,
  { request = api, onChange = () => {}, acceptLsp = () => {} } = {},
) {
  const pending = new Map();
  function cancel(path) {
    for (const [key, operation] of pending) {
      if (operation.path !== path) continue;
      operation.controller.abort();
      pending.delete(key);
    }
  }
  function fetchSymbols(path, kind) {
    const key = `${kind}:${path}`;
    if (pending.has(key)) return pending.get(key).promise;
    const buffer = store.buffers.get(path);
    const controller = new AbortController();
    const operation = { path, controller, promise: null };
    pending.set(key, operation);
    operation.promise = request(
      kind === 'outline' ? 'api/outline' : 'api/lsp/symbols',
      { path, wait: kind === 'lsp' ? 20000 : undefined },
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted || store.buffers.get(path) !== buffer) return;
        if (kind === 'lsp') acceptLsp(result);
        if (kind === 'lsp' && !result.symbols?.length) return;
        store.actions.patchDocument(path, {
          outline: result.symbols || [],
          outlineSource: result.server || '',
        });
        onChange();
      })
      .finally(() => {
        if (pending.get(key) === operation) pending.delete(key);
      });
    return operation.promise;
  }
  return {
    cancel,
    dispose: () => [...pending.values()].forEach((operation) => cancel(operation.path)),
    async load(path) {
      const document = store.state.documents.tabs.find((tab) => tab.path === path);
      if (!document) return;
      if (document.outline) return onChange();
      return fetchSymbols(path, 'outline');
    },
    async upgrade(path) {
      if (store.state.lsp.state !== 'off') return fetchSymbols(path, 'lsp');
    },
  };
}
