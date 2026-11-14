import { record } from '../decode.ts';
import { compare } from '../text.ts';
import type { EventSink } from '../http/events.ts';

interface FeedClient {
  keys: Set<string>;
  sink: EventSink;
}
interface FeedCache {
  frames: string[];
  valid: boolean;
}
function keys(query: URLSearchParams): Set<string> {
  const result = new Set<string>();
  if (query.get('threads') === '1') result.add('threads');
  for (const id of query.getAll('thread')) if (id) result.add('thread:' + id);
  if (query.get('review') === '1') result.add('review');
  return result;
}
function classify(frame: string): { key: string; snapshot: boolean } | undefined {
  const lines = frame.split('\n');
  const event = lines
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim();
  if (!event) return;
  if (event.startsWith('threads:')) return { key: 'threads', snapshot: event === 'threads:list' };
  if (event.startsWith('review:')) return { key: 'review', snapshot: event === 'review:snapshot' };
  if (!event.startsWith('thread:')) return;
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  const value: unknown = JSON.parse(data);
  const id = record(value).id;
  if (typeof id !== 'string') throw new Error('invalid legacy thread id');
  return { key: 'thread:' + id, snapshot: event === 'thread:thread' || event === 'thread:deleted' };
}
// One upstream holds the union of all browser subscriptions. Its Go publishers
// retain the 256-event thread buffers; each browser has a 64-frame fan-in queue.
export class LegacyFeeds {
  private readonly clients = new Set<FeedClient>();
  private readonly cache = new Map<string, FeedCache>();
  private controller: AbortController | undefined;
  private task: Promise<void> | undefined;
  private pending: Promise<void> = Promise.resolve();
  private current = '';
  private awaitingSnapshots = new Set<string>();
  private closed = false;
  constructor(
    readonly origin: string,
    readonly base: string,
  ) {}
  subscribe(query: URLSearchParams, sink: EventSink): () => void {
    const client = { keys: keys(query), sink };
    if (this.closed || !client.keys.size) return () => undefined;
    this.clients.add(client);
    let replayed = true;
    const replay: string[] = [];
    for (const key of client.keys) {
      const cached = this.cache.get(key);
      if (!cached?.valid) {
        replayed = false;
        continue;
      }
      replay.push(...cached.frames);
    }
    // Go writes initial feed snapshots together. Replay as one bounded batch so
    // a healthy reconnect does not overflow fan-in before its first body pull.
    if (replay.length) sink.send(replay.join(''));
    this.reconcile(!replayed);
    return () => {
      this.clients.delete(client);
      this.reconcile();
    };
  }
  private query(): string {
    const union = new Set<string>();
    for (const client of this.clients) for (const key of client.keys) union.add(key);
    for (const key of this.cache.keys()) if (!union.has(key)) this.cache.delete(key);
    const query = new URLSearchParams();
    for (const key of [...union].sort(compare)) {
      if (key.startsWith('thread:')) query.append('thread', key.slice(7));
      else query.set(key, '1');
    }
    return query.toString();
  }
  private reconcile(force = false): void {
    this.pending = this.pending.then(async () => {
      const query = this.closed ? '' : this.query();
      const needsSnapshot =
        force &&
        [...this.clients].some((client) =>
          [...client.keys].some(
            (key) => !this.cache.get(key)?.valid && !this.awaitingSnapshots.has(key),
          ),
        );
      if (query === this.current && (!needsSnapshot || !this.controller)) return;
      this.controller?.abort();
      await this.task;
      this.controller = undefined;
      this.current = query;
      if (!query || this.closed) return;
      const controller = new AbortController();
      this.controller = controller;
      this.awaitingSnapshots = new Set([...this.clients].flatMap((client) => [...client.keys]));
      this.task = this.run(query, controller).catch(() => {
        if (!controller.signal.aborted) {
          // A lost publisher closes the browser streams, matching Go's resync rule.
          for (const client of this.clients) client.sink.close();
        }
      });
    });
  }
  private async run(query: string, controller: AbortController): Promise<void> {
    const response = await fetch(this.origin + this.base + 'api/stream?' + query, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) throw new Error('legacy feeds unavailable');
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = '';
    try {
      while (!controller.signal.aborted) {
        const part = await reader.read();
        if (part.done) throw new Error('legacy feeds ended');
        pending = (pending + decoder.decode(part.value, { stream: true })).replaceAll('\r\n', '\n');
        let end = pending.indexOf('\n\n');
        let count = 0;
        while (end >= 0) {
          const text = pending.slice(0, end).replaceAll('\r', ''),
            frame = text + '\n\n';
          pending = pending.slice(end + 2);
          const kind = classify(text);
          if (kind && [...this.clients].some((client) => client.keys.has(kind.key))) {
            if (kind.snapshot) this.awaitingSnapshots.delete(kind.key);
            const previous = this.cache.get(kind.key);
            const cached = kind.snapshot ? { frames: [frame], valid: true } : previous;
            if (cached && !kind.snapshot && cached.valid) {
              if (cached.frames.length < (kind.key === 'review' ? 64 : 256))
                cached.frames.push(frame);
              else {
                cached.valid = false;
                cached.frames.length = 0;
              }
            }
            if (cached) this.cache.set(kind.key, cached);
            for (const client of this.clients)
              if (client.keys.has(kind.key)) client.sink.send(frame);
          }
          if (++count % 64 === 0) await Bun.sleep(0);
          end = pending.indexOf('\n\n');
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const client of this.clients) client.sink.close();
    this.clients.clear();
    this.controller?.abort();
    await this.pending;
    this.controller?.abort();
    await this.task;
    this.cache.clear();
  }
}
