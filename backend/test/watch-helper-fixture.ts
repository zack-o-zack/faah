import { readRecords } from '../src/git/records.ts';
import { request } from '../src/watch/protocol.ts';
const mode = process.argv[2];
await readRecords(Bun.stdin.stream(), 10, (line) => {
  if (!line) return;
  const value = request(line),
    { id, root, type } = value;
  if (mode === 'exit') process.exit(7);
  if (mode === 'bad') {
    process.stdout.write('{bad}\n');
    return;
  }
  if (mode === 'error') {
    process.stdout.write(JSON.stringify({ id, error: 'watch limit' }) + '\n');
    return;
  }
  if (
    (mode === 'stall' && type === 'subscribe') ||
    (mode === 'unsub-stall' && type === 'unsubscribe') ||
    root === 'blocked'
  )
    Bun.sleepSync(60000);
  process.stdout.write(JSON.stringify({ id }) + '\n');
  if (type === 'subscribe')
    process.stdout.write(
      JSON.stringify({ id, events: [{ path: root + '/proof.txt', type: 'update' }] }) + '\n',
    );
});
