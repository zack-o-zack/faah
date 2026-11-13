import { onCleanup } from 'solid-js';
import { api, apiPostJson } from '../lib/api.ts';
/** Completion is polled; live output uses the workspace's owned thread subscription. */
export function createAgentJobs(app, options = {}) {
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const controllers = new Set();
  let disposed = false;
  function wait(signal) {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 600);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  async function runAgentJob(endpoint, params, { signal: external, progress = () => {} } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    controllers.add(controller);
    const signal = controller.signal;
    let release;
    try {
      const job = await post(endpoint, params, { signal });
      if (signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
      release = app.actions.watchWorkspaceThread(job.threadId);
      progress({ ...job, running: true });
      while (!signal.aborted) {
        await wait(signal);
        let result;
        try {
          result = await request('api/agent/job', { id: job.id }, { signal });
        } catch (error) {
          if (error.body && 'running' in error.body) result = error.body;
          else throw error;
        }
        if (signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
        progress({ ...result, id: job.id, threadId: job.threadId });
        if (!result.running) {
          if (
            result.error &&
            !endpoint.endsWith('sync-agent') &&
            !endpoint.startsWith('api/agent/')
          )
            throw Object.assign(new Error(result.error), { body: result });
          return result;
        }
      }
      throw new DOMException('Cancelled', 'AbortError');
    } finally {
      release?.();
      controllers.delete(controller);
      external?.removeEventListener('abort', abort);
    }
  }
  onCleanup(() => {
    disposed = true;
    for (const controller of controllers) controller.abort();
  });
  return { runAgentJob, cancelAgentJob: (id) => post('api/agent/cancel', { id }) };
}
