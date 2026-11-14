import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flags, featureArgs, type Flags } from './cli/flags.ts';
import { lifetime } from './cli/lifetime.ts';
import { output } from './cli/output.ts';
import { bridge, recordTarget, viewerURL } from './cli/workspace.ts';
import { parse } from './decode.ts';
import { errorMessage } from './errors.ts';
import { asset } from './http/assets.ts';
import { listen } from './http/listen.ts';
import { basePath } from './http/paths.ts';
import { createRouter } from './http/router.ts';
import type { ServerProcess } from './http/server-process.ts';
import { Settings, atomicWrite } from './settings/service.ts';
import { openDB, stateDir } from './store/db.ts';
import { watchHelper } from './watch/helper.ts';
import { workbenchProcess } from './workbench/process.ts';
import { WorkbenchStore } from './workbench/store.ts';
import { workspaceProcess } from './workspace/process.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (bridge(args)) return;
  const parsed = flags(args);
  const version = new TextDecoder().decode(await asset('VERSION')).trim() || 'dev';
  if (wantsVersion(parsed)) {
    const platform = process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    output(`faah ${version} (${platform}/${arch})`);
    return;
  }
  if (parsed.bool.has('update')) return;
  const settings = new Settings();
  const base = basePath(parsed.basePath || configuredBasePath(settings));
  const isWorkspace = parsed.targets.length > 0 || parsed.bool.has('workbench-child');
  const desktop = parsed.bool.has('desktop-host');
  const lock = join(stateDir(), 'workbench.lock');
  if (!isWorkspace && !desktop && (await reuseRunningWorkbench(lock, !parsed.bool.has('no-open'))))
    return;
  const db = openDB();
  const served: ServerProcess = isWorkspace
    ? await workspaceProcess({ flags: parsed, base, version, settings })
    : workbenchProcess({
        db,
        base,
        version,
        settings,
        command: selfCommand(),
        features: featureArgs(parsed),
      });
  const server = listen(
    parsed.host,
    parsed.port,
    createRouter({
      base,
      gzip: served.gzip,
      routes: served.routes,
      onRequest: (route, request) => served.onRequest?.(route, request),
    }),
  );
  if (isWorkspace && !parsed.bool.has('workbench-child'))
    recordTarget(new WorkbenchStore(db), parsed.targets[0] ?? '.');
  const url = viewerURL(
    `http://${parsed.host}:${server.port}`,
    base,
    isWorkspace ? parsed.targets[0] : undefined,
  );
  if (parsed.bool.has('workbench-child')) output(`faah-ready ${parsed.host}:${server.port}`);
  else if (desktop) output('faah-desktop-ready ' + url);
  else output('faah ' + version + '\n' + url);
  if (!isWorkspace && !desktop) atomicWrite(lock, JSON.stringify({ pid: process.pid, url }) + '\n');
  if (!parsed.bool.has('no-open')) openBrowser(url);
  lifetime({
    desktop,
    stdinLifetime: parsed.bool.has('workbench-child') || desktop,
    lock,
    close: async () => {
      await served.close();
      await server.stop(true);
      db.close();
    },
  });
}

function wantsVersion(parsed: Flags): boolean {
  return (
    parsed.bool.has('version') ||
    parsed.bool.has('v') ||
    (parsed.targets.length === 1 && parsed.targets[0] === 'version')
  );
}

function configuredBasePath(settings: Settings): string {
  const raw = settings.raw();
  if (typeof raw['server.basePath'] === 'string') return raw['server.basePath'];
  if (typeof raw.basePath === 'string') return raw.basePath;
  return '/';
}

/** How a workbench starts its children: the compiled binary, or `bun main.ts` in development. */
function selfCommand(): string[] {
  return Bun.embeddedFiles.length === 0 ? [process.execPath, import.meta.path] : [process.execPath];
}

/** A second `faah` without a target opens the running workbench instead of starting one. */
async function reuseRunningWorkbench(lock: string, open: boolean): Promise<boolean> {
  try {
    const value = parse(readFileSync(lock, 'utf8'));
    if (typeof value.url !== 'string') return false;
    const response = await fetch(value.url.replace(/\/$/, '') + '/api/wb/ping', {
      signal: AbortSignal.timeout(400),
    });
    const ping: unknown = await response.json();
    if (
      typeof ping === 'object' &&
      ping !== null &&
      'workbench' in ping &&
      ping.workbench === true
    ) {
      if (open) openBrowser(value.url);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function openBrowser(url: string): void {
  const commands = [process.env.BROWSER, process.platform === 'darwin' ? 'open' : 'xdg-open'];
  for (const command of commands) {
    if (!command) continue;
    try {
      const child = Bun.spawn([command, url], { stdout: 'ignore', stderr: 'ignore' });
      child.unref();
      return;
    } catch {
      /* Try the platform launcher when BROWSER cannot be started. */
    }
  }
}

(process.argv[2] === '--internal-watcher' ? watchHelper() : main()).catch((error: unknown) => {
  console.error('faah: ' + errorMessage(error));
  process.exit(1);
});
