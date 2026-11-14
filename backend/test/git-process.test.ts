import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { GitProcesses } from '../src/git/process.ts';
import { GitProbe } from '../src/git/probe.ts';
import { gitFixture } from './git-fixture.ts';
import { record, string } from '../src/decode.ts';

test('Git process slots are bounded, queued requests cancel, and close reaps active children', async () => {
  const repo = await gitFixture(),
    script = join(repo.root, 'worker.ts');
  const pool = new GitProcesses(2, [process.execPath, script], repo.env);
  try {
    await repo.write('worker.ts', 'console.log("ready"); await Bun.sleep(2000);');
    let peak = 0,
      count = 0;
    let started = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = Array.from({ length: 6 }, () =>
      pool.run(repo.root, [], {
        delimiter: 10,
        consume: (line) => {
          if (line !== 'ready') return;
          peak = Math.max(peak, pool.active);
          if (++count === 2) started();
        },
      }),
    );
    const settled = Promise.allSettled(pending);
    await ready;
    expect(peak).toBe(2);
    await pool.close();
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
    expect(pool.active).toBe(0);
  } finally {
    await pool.close();
    await repo.cleanup();
  }
});

test('stream consumers throw without leaking process slots and queued aborts never spawn', async () => {
  const repo = await gitFixture(),
    script = join(repo.root, 'worker.ts'),
    pool = new GitProcesses(1, [process.execPath, script], repo.env);
  try {
    await repo.write('worker.ts', 'console.log("ready"); await Bun.sleep(500);');
    let started = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = pool.run(repo.root, [], {
      delimiter: 10,
      consume: () => {
        started();
      },
    });
    const controller = new AbortController(),
      second = pool.run(repo.root, [], { signal: controller.signal });
    const done = Promise.allSettled([first, second]);
    await ready;
    controller.abort(new Error('queued cancel'));
    const [, queued] = await done;
    expect(queued.status).toBe('rejected');
    await expect(
      pool.run(repo.root, [], {
        consume: () => {
          throw new Error('decode failed');
        },
        delimiter: 10,
      }),
    ).rejects.toThrow('decode failed');
    expect(pool.active).toBe(0);
  } finally {
    await pool.close();
    await repo.cleanup();
  }
});

test('probe safe-directory fallback matches global argv order and successful probes cache once', async () => {
  const repo = await gitFixture(),
    script = join(repo.root, 'probe.ts'),
    pool = new GitProcesses(2, [process.execPath, script], repo.env);
  try {
    await repo.write(
      'probe.ts',
      'import{appendFileSync}from"node:fs"; const a=process.argv.slice(2);appendFileSync(a[a.indexOf("-C")+1]+"/calls",JSON.stringify(a)+"\\n");if(a.includes("--show-toplevel")){if(!a.includes("safe.directory=*"))process.exit(128);console.log(a[a.indexOf("-C")+1]);}else console.log(".git");',
    );
    const probe = new GitProbe(pool);
    const first = await probe.get(repo.root);
    expect(await probe.get(repo.root)).toBe(first);
    const calls = (await Bun.file(join(repo.root, 'calls')).text())
      .trim()
      .split('\n')
      .map((line) => {
        const value: unknown = JSON.parse(line);
        if (!Array.isArray(value)) throw new Error('invalid args');
        return value.map((item) => string(item));
      });
    expect(calls).toEqual([
      ['-C', repo.root, 'rev-parse', '--show-toplevel'],
      ['-c', 'safe.directory=*', '-C', repo.root, 'rev-parse', '--show-toplevel'],
      ['-c', 'safe.directory=*', '-C', repo.root, 'rev-parse', '--git-dir'],
    ]);
  } finally {
    await pool.close();
    await repo.cleanup();
  }
});

test('processes suppress prompts, retain nonzero output, and accept patch input', async () => {
  const repo = await gitFixture(),
    script = join(repo.root, 'echo.ts'),
    pool = new GitProcesses(1, [process.execPath, script], repo.env);
  try {
    await repo.write(
      'echo.ts',
      'console.log(JSON.stringify({prompt:process.env.GIT_TERMINAL_PROMPT,input:await Bun.stdin.text()}));console.error("failure");process.exit(7);',
    );
    const result = await pool.run(repo.root, [], { input: 'patch\n' });
    const value: unknown = JSON.parse(result.stdout);
    expect(record(value)).toEqual({ prompt: '0', input: 'patch\n' });
    expect(result.code).toBe(7);
    expect(result.stderr).toContain('failure');
    expect(result.output).toContain('patch');
  } finally {
    await pool.close();
    await repo.cleanup();
  }
});
