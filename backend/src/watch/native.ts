import { subscribe, type Callback } from './binding.ts';
import { WatcherProcess } from './process.ts';

export class NativeWatcher {
  private readonly helper = process.platform === 'linux' ? new WatcherProcess() : undefined;
  get pid(): number | undefined {
    return this.helper?.pid;
  }
  subscribe = (root: string, callback: Callback): Promise<() => Promise<void>> =>
    this.helper ? this.helper.subscribe(root, callback) : subscribe(root, callback);
  async close(): Promise<void> {
    await this.helper?.close();
  }
}
