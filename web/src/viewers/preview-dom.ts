import { blockIndex } from './view.ts';
import {
  domToMarkdown,
  getFragmentPlainText,
  getFragmentHtml,
  getMarkdownRangeLines,
} from './markdown-dom.ts';
import { isMac } from '../lib/keyboard.ts';

export function createPreviewDOM(viewport: HTMLElement, article: HTMLElement) {
  const blocks = () => [...article.querySelectorAll<HTMLElement>('[data-line]')];
  const gap = () => article.querySelector('thead')?.getBoundingClientRect().height || 16;
  function line(n: number): void {
    const all = blocks();
    const el =
      all[
        blockIndex(
          all.map((el) => Number(el.dataset.line)),
          n,
        )
      ];
    if (!el || el.closest('thead')) viewport.scrollTop = 0;
    else
      viewport.scrollTop +=
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - gap();
  }
  function topLine(): number {
    if (!viewport.scrollTop) return 1;
    const top = viewport.getBoundingClientRect().top + gap() + 8;
    let line = 1;
    for (const el of blocks()) {
      if (el.getBoundingClientRect().top > top) break;
      line = Number(el.dataset.line);
    }
    return line;
  }
  function anchor(value: string): boolean {
    let id = value;
    try {
      id = decodeURIComponent(value);
    } catch {
      /* Retain malformed anchors as literal text. */
    }
    const el = [...article.querySelectorAll('[id]')].find(
      (el) => el.id === 'md-' + id || el.id === 'md-' + id.toLowerCase(),
    );
    if (el)
      viewport.scrollTop +=
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - gap();
    return !!el;
  }
  function clearMarks(): void {
    for (const mark of article.querySelectorAll('mark.md-hit'))
      mark.replaceWith(...mark.childNodes);
    article.normalize();
  }
  function find(query: string, sensitive: boolean): { line: number }[] {
    clearMarks();
    if (!query) return [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (
        node instanceof Text &&
        !node.parentElement?.closest('[hidden], .ln, .csv-cap, .md-mermaid-controls')
      )
        nodes.push(node);
    }
    const hits = [];
    const needle = sensitive ? query : query.toLowerCase();
    for (const node of nodes) {
      const text = node.nodeValue || '';
      const haystack = sensitive ? text : text.toLowerCase();
      let at = haystack.indexOf(needle);
      if (at < 0) continue;
      const fragment = document.createDocumentFragment();
      let start = 0;
      while (at >= 0) {
        fragment.append(text.slice(start, at));
        const mark = document.createElement('mark');
        mark.className = 'md-hit';
        mark.textContent = text.slice(at, at + needle.length);
        fragment.append(mark);
        hits.push({
          line: +(node.parentElement?.closest<HTMLElement>('[data-line]')?.dataset.line || 1),
        });
        start = at + needle.length;
        at = haystack.indexOf(needle, start);
      }
      fragment.append(text.slice(start));
      node.replaceWith(fragment);
    }
    return hits;
  }
  function showHit(index: number): void {
    const marks = [...article.querySelectorAll('mark.md-hit')];
    marks.forEach((mark, i) => mark.classList.toggle('on', i === index));
    marks[index]?.scrollIntoView({ block: 'center' });
  }
  function key(event: KeyboardEvent): boolean {
    const mod = isMac && event.metaKey;
    if (event.key === 'Home' || (mod && event.key === 'ArrowUp')) viewport.scrollTop = 0;
    else if (event.key === 'End' || (mod && event.key === 'ArrowDown'))
      viewport.scrollTop = viewport.scrollHeight;
    else {
      const distances: Record<string, number> = {
        ArrowDown: 48,
        j: 48,
        ArrowUp: -48,
        k: -48,
        PageDown: viewport.clientHeight * 0.9,
        PageUp: -viewport.clientHeight * 0.9,
      };
      const distance = distances[event.key];
      if (!distance) return false;
      viewport.scrollBy({ top: distance });
    }
    return true;
  }
  function selection(range: Range, document: { path: string }) {
    if (!article.contains(range.commonAncestorContainer)) return null;
    const fragment = range.cloneContents();
    const text = getFragmentPlainText(fragment).trim();
    if (!text) return null;
    const { l1, l2 } = getMarkdownRangeLines(range, article);
    return {
      text,
      html: getFragmentHtml(fragment),
      rawMarkdown: domToMarkdown(fragment).trim(),
      l1,
      l2,
      path: document.path,
      isMarkdownPreview: true,
    };
  }
  function select() {
    const range = document.createRange();
    range.selectNodeContents(article);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }
  return { line, topLine, anchor, find, clearMarks, showHit, key, selection, select };
}
