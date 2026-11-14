import { readFileSync, unlinkSync } from 'node:fs';
import { parse } from '../decode.ts';
export function lifetime(
  desktop: boolean,
  stdinLifetime: boolean,
  lock: string,
  close: () => Promise<void>,
): void {
  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(130);
    stopping = true;
    const timer = setTimeout(() => process.exit(desktop ? 0 : 130), 2000);
    await close();
    clearTimeout(timer);
    try {
      const data = parse(readFileSync(lock, 'utf8'));
      if (data.pid === process.pid) unlinkSync(lock);
    } catch {
      /* A missing or stale instance lock does not prevent startup. */
    }
    process.exit(desktop ? 0 : 130);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  if (stdinLifetime) {
    process.stdin.resume();
    process.stdin.on('end', () => {
      void shutdown();
    });
  }
}
