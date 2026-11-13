import type { DocTab } from './types.ts';
import type { Request } from '../lib/api.ts';
import { decodeSymbols } from './decode.ts';
import type { LspBrief } from './decode.ts';
import { api } from '../lib/api.ts';

export function createSymbolActions(
  ...args: Parameters<typeof buildSymbolActions>
): ReturnType<typeof buildSymbolActions> {
  return buildSymbolActions(...args);
}
function buildSymbolActions(
  store: {
    state: { documents: { tabs: DocTab[] }; lsp: { state: string } };
    buffers: ReadonlyMap<string, unknown>;
    actions: { patchDocument: (path: string, patch: Partial<DocTab>) => void };
  },
  {
    request = api,
    onChange = () => {},
    acceptLsp = () => {},
  }: { request?: Request; onChange?: () => void; acceptLsp?: (reply: LspBrief) => void } = {},
) {
  const pending = new Map<
    string,
    { path: string; controller: AbortController; promise: Promise<void> | null }
  >();
  function cancel(path: string): void {
    for (const [key, operation] of pending) {
      if (operation.path !== path) continue;
      operation.controller.abort();
      pending.delete(key);
    }
  }
  function fetchSymbols(path: string, kind: string): Promise<void> | undefined {
    const key = `${kind}:${path}`;
    if (pending.has(key)) return pending.get(key)?.promise || undefined;
    const buffer = store.buffers.get(path);
    const controller = new AbortController();
    const operation: { path: string; controller: AbortController; promise: Promise<void> | null } =
      { path, controller, promise: null };
    pending.set(key, operation);
    operation.promise = request(
      kind === 'outline' ? 'api/outline' : 'api/lsp/symbols',
      { path, wait: kind === 'lsp' ? 20000 : undefined },
      { signal: controller.signal },
    )
      .then((input) => {
        const result = decodeSymbols(input);
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
    async load(path: string) {
      const document = store.state.documents.tabs.find((tab) => tab.path === path);
      if (!document) return;
      if (document.outline) return onChange();
      return fetchSymbols(path, 'outline');
    },
    async upgrade(path: string) {
      if (store.state.lsp.state !== 'off') return fetchSymbols(path, 'lsp');
    },
  };
}
