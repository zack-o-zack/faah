import { Navigation } from './index/navigation.ts';
import { detectPR, resolveTarget } from './cli/target.ts';
import { bridge, recordTarget, viewerURL } from './cli/workspace.ts';
import { handler } from './http/router.ts';
import { listen } from './http/listen.ts';
import { lifetime } from './cli/lifetime.ts';
import { output } from './cli/output.ts';
import { realpathSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flags, featureArgs } from './cli/flags.ts';
import { startLegacy } from './legacy/start.ts';
import { basePath } from './http/paths.ts';
import { asset } from './http/assets.ts';
import type { Child } from './legacy/child.ts';
import { Settings, atomicWrite } from './settings/service.ts';
import { openDB, stateDir } from './store/db.ts';
import { WorkbenchStore } from './workbench/store.ts';
import { Workbench } from './workbench/service.ts';
import { parse, message } from './decode.ts';
import { watchHelper } from './watch/helper.ts';

async function main(): Promise<void> {
  if (bridge(process.argv.slice(2))) return;
  const parsed = flags(process.argv.slice(2));
  const features = featureArgs(parsed);
  const version = new TextDecoder().decode(await asset('VERSION')).trim() || 'dev';
  if (
    parsed.bool.has('version') ||
    parsed.bool.has('v') ||
    (parsed.targets.length === 1 && parsed.targets[0] === 'version')
  ) {
    output(
      `faah ${version} (${process.platform === 'darwin' ? 'darwin' : process.platform}/${process.arch === 'x64' ? 'amd64' : process.arch})`,
    );
    return;
  }
  if (parsed.bool.has('update')) return;
  const settings = new Settings();
  const raw = settings.raw();
  const base = basePath(
    parsed.basePath ||
      (typeof raw['server.basePath'] === 'string'
        ? raw['server.basePath']
        : typeof raw.basePath === 'string'
          ? raw.basePath
          : '/'),
  );
  const workspace = parsed.targets.length > 0 || parsed.bool.has('workbench-child');
  const lock = join(stateDir(), 'workbench.lock');
  if (
    !workspace &&
    !parsed.bool.has('desktop-host') &&
    (await reuse(lock, !parsed.bool.has('no-open')))
  )
    return;
  const db = openDB();
  const store = new WorkbenchStore(db);
  let legacy: Child | undefined;
  let wb: Workbench | undefined;
  const self =
    Bun.embeddedFiles.length === 0 ? [process.execPath, import.meta.path] : [process.execPath];
  if (workspace) legacy = await startLegacy(parsed, base);
  else
    wb = new Workbench({ store, base, cwd: realpathSync(process.cwd()), command: self, features });
  const pr = Boolean(detectPR(parsed.targets[0] ?? ''));
  const navigation = workspaceNavigation({
    legacy,
    base,
    version,
    target: parsed.targets[0] ?? '.',
    workbench: parsed.bool.has('workbench-child'),
    gitEnabled: !parsed.bool.has('no-git'),
  });
  const handle = handler({
    base,
    workspace,
    version,
    settings,
    wb,
    legacy,
    lspEnabled: !parsed.bool.has('no-lsp') && workspace,
    navigation,
    pr,
  });
  const server = listen(parsed.host, parsed.port, handle);
  if (workspace && !parsed.bool.has('workbench-child'))
    recordTarget(store, parsed.targets[0] ?? '.');
  const url = viewerURL(
    `http://${parsed.host}:${server.port}`,
    base,
    workspace ? parsed.targets[0] : undefined,
  );
  if (parsed.bool.has('workbench-child')) output(`faah-ready ${parsed.host}:${server.port}`);
  else if (parsed.bool.has('desktop-host')) output('faah-desktop-ready ' + url);
  else output('faah ' + version + '\n' + url);
  if (wb && !parsed.bool.has('desktop-host'))
    atomicWrite(lock, JSON.stringify({ pid: process.pid, url }) + '\n');
  if (!parsed.bool.has('no-open')) openBrowser(url);
  lifetime({
    desktop: parsed.bool.has('desktop-host'),
    stdinLifetime: parsed.bool.has('workbench-child') || parsed.bool.has('desktop-host'),
    lock,
    close: async () => {
      await navigation?.close();
      await Promise.all([legacy?.stop(1500), wb?.close()]);
      await server.stop(true);
      db.close();
    },
  });
}

function workspaceNavigation(options: {
  legacy: Child | undefined;
  base: string;
  version: string;
  target: string;
  workbench: boolean;
  gitEnabled: boolean;
}): Navigation | undefined {
  const { legacy, base, version, target, workbench } = options;
  if (!legacy || detectPR(target)) return;
  return new Navigation({
    child: legacy,
    gitEnabled: options.gitEnabled,
    base,
    root: resolveTarget(target).root,
    version,
    workbench: workbench
      ? base.includes('/w/')
        ? base.slice(0, base.lastIndexOf('/w/') + 1)
        : '/'
      : '',
  });
}

async function reuse(lock: string, open: boolean): Promise<boolean> {
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
  console.error('faah: ' + message(error));
  process.exit(1);
});
