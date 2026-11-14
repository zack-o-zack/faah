export interface Metrics {
  rssBytes: number;
  peakRSSBytes: number;
  cpuUsage: number;
  goroutines: number;
  lspEnabled: boolean;
  lspMemBytes: number;
}
export class MetricsCollector {
  private time = performance.now();
  private cpu = process.cpuUsage();
  private usage = 0;
  async collect(pids: number[] = [], lspEnabled = false, lspPids: number[] = []): Promise<Metrics> {
    const now = performance.now();
    const cpu = process.cpuUsage();
    if (now - this.time >= 200) {
      this.usage = Math.max(
        0,
        (cpu.user + cpu.system - this.cpu.user - this.cpu.system) / (now - this.time) / 10,
      );
      this.cpu = cpu;
      this.time = now;
    }
    const extra = (await Promise.all(pids.map(rss))).reduce((a, b) => a + b, 0);
    const memory = process.memoryUsage().rss + extra;
    return {
      rssBytes: memory,
      peakRSSBytes: Math.max(memory, process.resourceUsage().maxRSS * 1024 + extra),
      cpuUsage: this.usage,
      goroutines: pids.length,
      lspEnabled,
      lspMemBytes: (await Promise.all(lspPids.map(rss))).reduce((a, b) => a + b, 0),
    };
  }
}
export async function rss(pid: number): Promise<number> {
  const p = Bun.spawn(['ps', '-o', 'rss=', '-p', String(pid)], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const text = (await new Response(p.stdout).text()).trim();
  await p.exited;
  return /^\d+$/.test(text) ? Number(text) * 1024 : 0;
}
