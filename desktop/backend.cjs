const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

const READY_PREFIX = 'faah-desktop-ready ';

function startBackend(executable, { cwd, env = process.env, timeout = 30_000 } = {}) {
  const child = spawn(executable, ['-desktop-host', '-no-color'], {
    cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let exited = false;
  let stopping = false;
  let stopPromise;
  let diagnostic = '';
  // An early crash can close the pipe before the app attempts to shut down.
  child.stdin.on('error', () => {});
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });

  const exit = new Promise(resolve => {
    child.once('error', error => { exited = true; resolve({ error }); });
    child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The faah backend did not start within 30 seconds.'));
      void stop();
    }, timeout);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (!line.startsWith(READY_PREFIX)) return;
      try {
        const url = new URL(line.slice(READY_PREFIX.length));
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
            url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
          throw new Error('The backend reported an invalid local address.');
        }
        clearTimeout(timer);
        resolve(url.origin);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        void stop();
      }
    });
    exit.then(result => {
      clearTimeout(timer);
      lines.close();
      reject(result.error || new Error(`The faah backend exited (${result.code ?? result.signal}).\n${diagnostic}`));
    });
  });

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      if (exited) return;
      // Closing stdin lets Go stop all workspace and language-server children.
      child.stdin.end();
      const force = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exit;
      clearTimeout(force);
    })();
    return stopPromise;
  }

  return { ready, exit, stop, get pid() { return child.pid; }, get stopping() { return stopping; } };
}

module.exports = { startBackend };
