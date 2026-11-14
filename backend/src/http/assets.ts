import { content } from './content.ts';
import { staticCandidates } from './static-path.ts';
import { join, posix } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { assets } from './manifest.js';
import type { Settings } from '../settings/service.ts';
import { escapeHTML } from '../workbench/holding.ts';
import { vendorAsset } from './vendor.ts';
import { missing } from './response.ts';
export async function asset(name: string): Promise<Uint8Array | undefined> {
  try {
    if (process.env.FAAH_DEV_ROOT) return await readFile(join(process.env.FAAH_DEV_ROOT, name));
    const path = assets[name];
    return path ? new Uint8Array(await Bun.file(path).arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}
export async function assetNames(): Promise<string[]> {
  if (process.env.FAAH_DEV_ROOT)
    return (await readdir(join(process.env.FAAH_DEV_ROOT, 'web/themes'))).map(
      (n) => 'web/themes/' + n,
    );
  return Object.keys(assets);
}
export async function themes(): Promise<string> {
  let css = '';
  for (const name of (await assetNames()).filter((n) => /^web\/themes\/[^/]+\.css$/.test(n)).sort())
    css += `/* ${name.slice(4)} */\n${new TextDecoder().decode(await asset(name))}\n`;
  return css;
}
export function mime(name: string): string {
  const ext = posix.extname(name).toLowerCase();
  const types: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  return types[ext] ?? 'application/octet-stream';
}
export async function staticAsset(rel: string, request: Request): Promise<Response> {
  for (const name of staticCandidates(rel)) {
    let bytes = await asset(name);
    if (!bytes && name.endsWith('.gz') && rel.startsWith('vendor/')) bytes = await vendorAsset(rel);
    if (!bytes) continue;
    const headers = new Headers({ 'Content-Type': mime(rel) });
    if (name.endsWith('.gz')) {
      headers.set('Vary', 'Accept-Encoding');
      if (rel.startsWith('vendor/'))
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      if (request.headers.get('accept-encoding')?.includes('gzip'))
        headers.set('Content-Encoding', 'gzip');
      else bytes = Bun.gunzipSync(new Uint8Array(bytes));
    }
    let modified: Date | undefined;
    if (process.env.FAAH_DEV_ROOT) {
      try {
        modified = (await stat(join(process.env.FAAH_DEV_ROOT, name))).mtime;
      } catch {
        /* Cached vendor bytes may live outside the dev root. */
      }
    }
    return content(bytes, request, headers, modified);
  }
  const response = missing();
  response.headers.set('X-Static-Missing', '1');
  return response;
}
export async function index(
  base: string,
  workbench: boolean,
  theme = 'catppuccin-mocha',
): Promise<Response> {
  let text = new TextDecoder().decode(
    await asset(workbench ? 'web/workbench.html' : 'web/index.html'),
  );
  text = text.replace(/<base\s+href="[^"]*"\s*\/?\s*>/g, `<base href="${escapeHTML(base)}">`);
  if (workbench)
    text = text.replace('data-theme="catppuccin-mocha"', `data-theme="${escapeHTML(theme)}"`);
  return new Response(text, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function themeName(settings: Settings): Promise<string> {
  const theme = settings.raw()['workbench.colorTheme'];
  return typeof theme === 'string' &&
    theme &&
    !/[\\/]/.test(theme) &&
    (await asset('web/themes/' + theme + '.css'))
    ? theme
    : 'catppuccin-mocha';
}
