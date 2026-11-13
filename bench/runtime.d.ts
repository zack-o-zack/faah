// The harness uses only this small, dependency-free subset of Bun's runtime API.
declare const Bun: {
  nanoseconds(): number;
  version: string;
  spawn(
    argv: string[],
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: 'pipe' | 'ignore';
      stdout: 'pipe';
      stderr: 'pipe' | 'inherit';
    },
  ): {
    pid: number;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    stdin: { end(): void };
    exited: Promise<number>;
    kill(signal?: number | string): void;
  };
};
interface ImportMeta {
  main: boolean;
}
