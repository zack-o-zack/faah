export function listen(
  host: string,
  port: number,
  handle: (request: Request) => Promise<Response>,
) {
  let server: ReturnType<typeof Bun.serve> | undefined;
  const ports = port === 0 ? [0] : [...Array.from({ length: 100 }, (_, i) => port + i), 0];
  for (const candidate of ports) {
    try {
      server = Bun.serve({
        hostname: host,
        port: candidate,
        fetch: handle,
        idleTimeout: 0,
        maxRequestBodySize: Number.MAX_SAFE_INTEGER,
      });
      break;
    } catch (error) {
      if (candidate === 0) throw error;
    }
  }
  if (!server) throw new Error('could not listen');
  return server;
}
