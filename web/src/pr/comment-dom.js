import { sanitizeMarkdown } from '../viewers/markdown-dom.ts';

const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'];

/**
 * A posted comment's server-rendered Markdown as a sanitized fragment, with the
 * forge's alert quotes ([!NOTE] and the like) styled as alerts. DOM adapter only.
 */
export function commentFragment(html) {
  const fragment = sanitizeMarkdown(html);
  for (const quote of fragment.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild;
    const match = first?.localName === 'p' && /^\s*\[!(\w+)\]\s*/.exec(first.textContent);
    const kind = match && match[1].toLowerCase();
    if (!kind || !ALERT_KINDS.includes(kind)) continue;
    const text = first.firstChild;
    if (text?.nodeType === 3) text.textContent = text.textContent.replace(/^\s*\[!\w+\]\s*/, '');
    if (!first.textContent.trim() && !first.querySelector('img')) first.remove();
    quote.classList.add('thr-alert', 'thr-alert-' + kind);
    const title = document.createElement('p');
    title.className = 'thr-alert-title';
    title.textContent = kind[0].toUpperCase() + kind.slice(1);
    quote.prepend(title);
  }
  return fragment;
}
