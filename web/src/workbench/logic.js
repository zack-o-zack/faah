export const looksLikeURL = (value) => /^[a-z]+:\/\//i.test(value.trim());
export function fieldKind(value) {
  const text = value.trim();
  if (!text) return 'empty';
  if (!looksLikeURL(text)) return 'dir';
  return /\/(pull|pulls|merge_requests)\/\d+/.test(text) ? 'pr' : 'link';
}
export const tildify = (path, home, sep = '/') =>
  home && (path === home || path.startsWith(home + sep)) ? '~' + path.slice(home.length) : path;
export function ago(ms, now = Date.now()) {
  const seconds = Math.max(0, (now - ms) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 86400 * 30) return Math.floor(seconds / 86400) + 'd ago';
  return new Date(ms).toLocaleDateString();
}
export function recentGroups(items, showAll) {
  const pinned = items.filter((item) => item.pinned);
  const rest = items.filter((item) => !item.pinned);
  return {
    pinned,
    recent: showAll ? rest : rest.slice(0, Math.max(0, 12 - pinned.length)),
    total: items.length,
  };
}
export function breadcrumbs(path, home, sep = '/') {
  const inHome = home && (path === home || path.startsWith(home + sep));
  let at = inHome ? home : '';
  const crumbs = [{ name: inHome ? '~' : sep, path: inHome ? home : sep }];
  for (const part of (inHome ? path.slice(home.length) : path).split(sep).filter(Boolean)) {
    at += sep + part;
    crumbs.push({ name: part, path: at });
  }
  return crumbs;
}

export function openLabel(kind) {
  if (kind === 'pr') return 'Open PR';
  if (kind === 'dir') return 'Open folder';
  return 'Open';
}
export function recentSubtitle(item, home, sep) {
  if (item.state === 'failed') return item.error;
  if (item.state === 'starting') return item.progress;
  if (item.kind === 'pr') return `${item.repo}#${item.number}`;
  return tildify(item.path, home, sep);
}
