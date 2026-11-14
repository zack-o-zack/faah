import { goString } from '../render/text.ts';

function unescape(value: string, host = false): string {
  const input = Buffer.from(value),
    bytes: number[] = [];
  const zone = host && value.startsWith('[') ? input.indexOf('%25') : -1;
  const hostByte = (byte: number) =>
    byte >= 128 || /^[\w.!$&'()*+,;=:[\]<>"~-]$/.test(String.fromCharCode(byte));
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] ?? 0;
    if (byte === 37) {
      const hex = input.subarray(i + 1, i + 3).toString();
      if (!/^[\da-fA-F]{2}$/.test(hex)) throw new Error('invalid URL escape');
      const decoded = Number.parseInt(hex, 16);
      if (
        host &&
        decoded < 128 &&
        decoded !== 37 &&
        !(zone >= 0 && i >= zone && (decoded === 32 || hostByte(decoded)))
      )
        throw new Error('invalid host escape');
      bytes.push(decoded);
      i += 2;
    } else {
      if (host && !hostByte(byte)) throw new Error('invalid host');
      bytes.push(byte);
    }
  }
  return goString(Uint8Array.from(bytes));
}
function httpRemote(raw: string): { host: string; path: string } | undefined {
  try {
    if (/[\x00-\x1f\x7f]/.test(raw)) return;
    const match = /^https?:\/\/([^/?#]*)([^?#]*)/.exec(raw);
    if (!match) return;
    const authority = match[1] ?? '',
      at = authority.lastIndexOf('@');
    if (at >= 0) {
      const user = authority.slice(0, at);
      if (!/^[\w.\-:~!$&'()*+,;=%@]*$/.test(user)) return;
      unescape(user);
    }
    const host = authority.slice(at + 1),
      bracket = host.startsWith('[');
    const end = bracket ? host.lastIndexOf(']') : -1;
    if (bracket && end < 0) return;
    const port = bracket ? host.slice(end + 1) : host.slice(host.lastIndexOf(':'));
    if (((bracket && port) || (!bracket && host.includes(':'))) && !/^:\d*$/.test(port)) return;
    const fragment = raw.indexOf('#');
    if (fragment >= 0) unescape(raw.slice(fragment + 1));
    return { host: unescape(host, true), path: unescape(match[2] ?? '').replace(/^\//, '') };
  } catch {
    return;
  }
}
export function remoteHostPath(raw: string): { host: string; path: string } | undefined {
  raw = raw.replace(/\.git$/, '');
  if (raw.startsWith('git@')) {
    const colon = raw.indexOf(':', 4);
    return colon < 0
      ? undefined
      : { host: raw.slice(4, colon), path: raw.slice(colon + 1).replace(/^\//, '') };
  }
  if (raw.startsWith('ssh://')) {
    let clean = raw.slice(6);
    const at = clean.indexOf('@');
    if (at >= 0) clean = clean.slice(at + 1);
    const slash = clean.indexOf('/');
    return slash < 0 ? undefined : { host: clean.slice(0, slash), path: clean.slice(slash + 1) };
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) return httpRemote(raw);
}
