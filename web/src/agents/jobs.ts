import type { Request } from '../lib/api.ts';
import type { AgentJob } from './job-decode.ts';
import { decodeAgentJob } from './job-decode.ts';
export interface AgentJobOptions {
  signal?: AbortSignal;
  progress?: (job: AgentJob) => void;
}
interface JobsHost {
  actions: { watchWorkspaceThread: (id: string) => () => void };
}
import { onCleanup } from 'solid-js';
import { api, apiPostJson } from '../lib/api.ts';
/** Completion is polled; live output uses the workspace's owned thread subscription. */
export function createAgentJobs(
  app: JobsHost,
  options: { request?: Request; post?: Request } = {},
): ReturnType<typeof buildAgentJobs> {
  return buildAgentJobs(app, options);
}
function buildAgentJobs(app: JobsHost, options: { request?: Request; post?: Request } = {}) {
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const controllers = new Set<AbortController>();
  let disposed = false;
  function wait(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
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
  async function runAgentJob(
    endpoint: string,
    params: unknown,
    { signal: external, progress = () => {} }: AgentJobOptions = {},
  ): Promise<AgentJob> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    controllers.add(controller);
    const signal = controller.signal;
    let release: (() => void) | undefined;
    try {
      const job = decodeAgentJob(await post(endpoint, params, { signal }));
      if (signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
      release = app.actions.watchWorkspaceThread(job.threadId);
      progress({ ...job, running: true });
      while (!signal.aborted) {
        await wait(signal);
        let result;
        try {
          result = decodeAgentJob(await request('api/agent/job', { id: job.id }, { signal }));
        } catch (error) {
          if (
            error instanceof Error &&
            'body' in error &&
            typeof error.body === 'object' &&
            error.body !== null &&
            'running' in error.body
          )
            result = decodeAgentJob(error.body);
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
  return { runAgentJob, cancelAgentJob: (id?: number) => post('api/agent/cancel', { id }) };
}
