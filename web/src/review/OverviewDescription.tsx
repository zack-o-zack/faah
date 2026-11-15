import type { JSX } from 'solid-js';
import { createMemo } from 'solid-js';
import type { PROverview } from '../pr/types.ts';
import { sanitizeMarkdown, enhanceMarkdown } from '../viewers/markdown-dom.ts';
import { copyText } from '../lib/clipboard.ts';

// Resolve forge shorthand only in prose, never inside code or an existing link.
function linkReferences(fragment: DocumentFragment, prURL: string): void {
  let base: URL;
  try {
    base = new URL(prURL);
  } catch {
    return;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return;
  const issuePath = base.pathname.replace(
    /\/(?:pull|pulls|pull-requests|pullrequests|merge_requests)\/\d+(?:\/.*)?$/,
    '/issues/',
  );
  if (issuePath === base.pathname) return;
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) if (walker.currentNode instanceof Text) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest('a, code, pre')) continue;
    const source = node.textContent || '';
    const matches = [...source.matchAll(/(^|[\s(])(#\d+|@[a-z\d][\w-]*)/gi)];
    if (!matches.length) continue;
    const replacement = document.createDocumentFragment();
    let at = 0;
    for (const match of matches) {
      const prefix = match[1] || '';
      const value = match[2] || '';
      const start = match.index + prefix.length;
      replacement.append(document.createTextNode(source.slice(at, start)));
      const anchor = document.createElement('a');
      const url = new URL(base.origin);
      url.pathname = value.startsWith('#') ? issuePath + value.slice(1) : '/' + value.slice(1);
      anchor.href = url.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = value;
      replacement.append(anchor);
      at = start + value.length;
    }
    replacement.append(document.createTextNode(source.slice(at)));
    node.replaceWith(replacement);
  }
}

// The same sanitized Goldmark/Chroma output and enhancements as the Markdown preview.
// Only the container's .md prose style differs from compact PR comments.
export function OverviewDescription(props: {
  description: PROverview['description'];
  prURL: string;
}): JSX.Element {
  const fragment = createMemo(() => {
    const result = sanitizeMarkdown(props.description.bodyHtml);
    linkReferences(result, props.prURL);
    const wrapper = document.createElement('div');
    wrapper.append(result);
    enhanceMarkdown(wrapper);
    result.append(...wrapper.childNodes);
    return result;
  });
  return (
    <article
      class="md m-0! max-w-[82ch]! p-0! min-w-0"
      aria-label="PR description"
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        const copy = event.target.closest('[data-control~=md-copy]');
        if (copy)
          void copyText(
            copy.closest('.md-pre')?.querySelector('pre')?.textContent || '',
            'Code copied',
          );
      }}
    >
      {fragment()}
    </article>
  );
}
