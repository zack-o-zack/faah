export class LRU<T> {
  readonly entries = new Map<string, { value: T; bytes: number }>();
  used = 0;
  constructor(readonly budget = 64 << 20) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  put(key: string, value: T, bytes: number): void {
    if (this.get(key) !== undefined) return;
    this.entries.set(key, { value, bytes });
    this.used += bytes;
    this.trim(this.budget);
  }
  grow(key: string, delta: number): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.bytes += delta;
    this.used += delta;
    this.trim(this.budget);
  }
  remove(prefix: string): boolean {
    let removed = false;
    for (const [key, entry] of this.entries)
      if (key === prefix || key.startsWith(prefix + '|')) {
        this.entries.delete(key);
        this.used -= entry.bytes;
        removed = true;
      }
    return removed;
  }
  trim(budget = 8 << 20): void {
    for (const [key, entry] of this.entries) {
      if (this.used <= budget || this.entries.size <= 1) break;
      this.entries.delete(key);
      this.used -= entry.bytes;
    }
  }
  clear(): void {
    this.entries.clear();
    this.used = 0;
  }
}
