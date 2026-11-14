export class IdleScavenger {
  private last = Date.now();
  private done = true;
  private timer: ReturnType<typeof setInterval>;
  constructor(readonly scavenge: () => void) {
    this.timer = setInterval(() => this.tick(), 10000);
    this.timer.unref();
  }
  request(route: string, accept: string | null): void {
    if (
      route === 'api/metrics' ||
      route === 'api/stream' ||
      route === 'api/git/stream' ||
      accept === 'text/event-stream'
    )
      return;
    this.last = Date.now();
    this.done = false;
  }
  tick(now = Date.now()): void {
    if (now - this.last < 15000) return;
    if (this.done) return;
    this.scavenge();
    this.done = true;
  }
  close(): void {
    clearInterval(this.timer);
  }
}
