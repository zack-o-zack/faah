import type { Item } from './store.ts';
import type { Workspace } from './service.ts';
export function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;')
    .replace(/'/g, '&#39;')
    .replace(/\+/g, '&#43;');
}
export function holding(options: {
  base: string;
  theme: string;
  self: string;
  item: Item | undefined;
  workspace: Workspace | undefined;
  retry: boolean;
}): Response {
  const { base, theme, self, item, workspace, retry } = options;
  const starting = Boolean(item) && (workspace?.state !== 'failed' || retry);
  const title = item
    ? item.title || (item.kind === 'pr' ? `${item.repo}#${item.number}` : '')
    : 'Not found';
  const sub = item?.kind === 'pr' ? `${item.repo}#${item.number}` : (item?.path ?? '');
  const page = {
    Base: base,
    Theme: theme,
    Title: title,
    Error: !item ? 'This workspace is not in the workbench any more.' : (workspace?.error ?? ''),
    Retry: !starting && !workspace?.gone ? self + '?retry=1' : '',
    Self: starting ? self : '',
    Progress: workspace?.progress ?? '',
    Sub: sub,
    PR: item?.kind === 'pr',
    Choose: workspace?.noClone ? base + '?open=' + encodeURIComponent(item?.url ?? '') : '',
    Starting: starting,
  };
  const text = `<!doctype html>
<html lang="en" data-theme="${escapeHTML(theme)}">
<head>
<meta charset="utf-8">
<base href="${escapeHTML(base)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
${starting ? `<noscript><meta http-equiv="refresh" content="1; url=${escapeHTML(self)}"></noscript>\n` : ''}
<script defer src="static/holding.js"></script>
<title>${starting ? 'Opening…' : 'faah'}</title>
<link rel="icon" type="image/svg+xml" href="static/favicon.svg">
<link rel="stylesheet" href="static/app.css">
<link rel="stylesheet" href="static/themes.css">
</head>
<body><div id="root" data-page="${escapeHTML(JSON.stringify(page))}"></div>
</body>
</html>
`;
  return new Response(text, {
    status: item ? 200 : 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
