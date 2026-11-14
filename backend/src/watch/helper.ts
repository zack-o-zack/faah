import { subscribe } from './binding.ts';
import { request } from './protocol.ts';
import { readRecords } from '../git/records.ts';
import { message } from '../decode.ts';

export async function watchHelper(): Promise<void> {
  const subscriptions = new Map<number, () => Promise<void>>();
  const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  const handle = async (line: string) => {
    const value = request(line),
      { id } = value;
    try {
      if (value.type === 'subscribe') {
        const stop = await subscribe(value.root, (error, events) =>
          send(error ? { id, error: message(error) } : { id, events }),
        );
        subscriptions.set(id, stop);
      } else {
        await subscriptions.get(id)?.();
        subscriptions.delete(id);
      }
      send({ id });
    } catch (error) {
      send({ id, error: message(error) });
    }
  };
  try {
    await readRecords(Bun.stdin.stream(), 10, (line) => {
      if (line) void handle(line).catch(() => process.exit(1));
    });
  } finally {
    // Parent pipe EOF must also stop a helper with live native subscriptions.
    process.exit(0);
  }
}
if (import.meta.main) void watchHelper().catch(() => process.exit(1));
