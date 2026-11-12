import { createInterface } from 'node:readline';

// SDK background writes can outlive cancelled streams or failed shell spawns.
process.on('unhandledRejection', reason => {
  const closed = reason instanceof Error && (
    reason.name === 'WriteIterableClosedError' ||
    (reason.name === 'ConnectError' && reason.cause?.code === 'ERR_STREAM_WRITE_AFTER_END')
  );
  const shell = typeof reason?.syscall === 'string' && reason.syscall.startsWith('spawn') &&
    typeof reason.code === 'string' && Array.isArray(reason.spawnargs) &&
    reason.spawnargs.some(arg => typeof arg === 'string' &&
      ['dump_zsh_state', 'dump_bash_state', '__CURSOR_SANDBOX_ENV_RESTORE'].some(marker => arg.includes(marker)));
  console.error('Cursor SDK rejection:', reason);
  if (!closed && !shell) process.exit(1);
});

const { Agent } = await import('@cursor/sdk');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const message = error => error?.message ?? String(error);
let agent, starting, active, cwd, recover = false;

async function cancel(state) {
  if (!state) return;
  state.cancelled = true;
  if (state.run) {
    state.cancelling ??= Promise.resolve().then(() => state.run.cancel()).catch(error => {
      if (error?.name !== 'AbortError') throw error;
    });
    await state.cancelling;
  }
}

async function send(request, state) {
  try {
    const options = { ...request.options, onDelta: async ({ update }) => { emit({ op: 'delta', update }); } };
    try {
      state.run = await agent.send(request.text, options);
    } catch (error) {
      if (!recover || !/already has active run/i.test(message(error))) throw error;
      recover = false;
      const runOptions = { runtime: 'local', cwd };
      const stale = (await Agent.listRuns(agent.agentId, { ...runOptions, limit: 1 })).items.find(r => r.status === 'running');
      if (!stale) throw error;
      await Agent.cancelRun(stale.id, runOptions);
      state.run = await agent.send(request.text, options);
    }
    recover = false;
    if (state.cancelled) await cancel(state);
    const result = await state.run.wait();
    emit({ op: 'done', status: result.status, error: result.error?.message, result: result.result });
  } catch (error) {
    emit({ op: 'done', status: 'error', error: message(error) });
  } finally {
    active = undefined;
  }
}

async function close() {
  await cancel(active);
  await starting;
  await agent?.close();
}

const input = createInterface({ input: process.stdin });
for await (const line of input) {
  try {
    const request = JSON.parse(line);
    switch (request.op) {
      case 'open': {
        const options = { ...request.options };
        if (process.env.CURSOR_API_KEY) options.apiKey = process.env.CURSOR_API_KEY;
        cwd = options.local.cwd;
        recover = Boolean(request.agentId);
        agent = recover ? await Agent.resume(request.agentId, options) : await Agent.create(options);
        emit({ op: 'opened', agentId: agent.agentId });
        break;
      }
      case 'send':
        if (!agent || active) throw new Error('cursor session is not ready for a turn');
        active = { cancelled: false };
        starting = send(request, active);
        break;
      case 'cancel':
        await cancel(active);
        break;
      case 'close':
        await close();
        process.exit(0);
      default:
        throw new Error('unknown cursor helper operation');
    }
  } catch (error) {
    emit({ op: 'error', message: message(error) });
  }
}
await close();
