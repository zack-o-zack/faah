import { onCleanup } from 'solid-js';

export function createHighlights(): ReturnType<typeof buildHighlights> {
  return buildHighlights();
}
function buildHighlights() {
  const groups = new Map<string, Highlight>();
  const owners = new Map<unknown, [string, Range[]][]>();
  function remove(owner: unknown): void {
    for (const [name, ranges] of owners.get(owner) || []) {
      for (const range of ranges) groups.get(name)?.delete(range);
    }
    owners.delete(owner);
  }
  onCleanup(() => {
    for (const name of groups.keys()) CSS.highlights.delete(name);
  });
  return {
    remove,
    update(owner: unknown, marks: [string, Range[]][]) {
      remove(owner);
      if (!globalThis.Highlight || !globalThis.CSS?.highlights) return;
      owners.set(owner, marks);
      for (const [name, ranges] of marks) {
        if (!groups.has(name)) {
          const group = new Highlight();
          groups.set(name, group);
          CSS.highlights.set(name, group);
        }
        for (const range of ranges) groups.get(name)?.add(range);
      }
    },
  };
}
export function textRanges(
  element: Element,
  query: string | null | undefined,
  caseSensitive = true,
): Range[] {
  if (!query) return [];
  const text = element.textContent;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node instanceof Text) nodes.push(node);
  function point(offset: number): [Node, number] {
    for (const node of nodes) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
    }
    return [element, element.childNodes.length];
  }
  const ranges = [];
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) >= 0) {
    const range = document.createRange();
    range.setStart(...point(at));
    range.setEnd(...point(at + query.length));
    ranges.push(range);
    at += needle.length;
  }
  return ranges;
}

export function markOccurrences(element: HTMLElement, query = ''): void {
  const selection = document.getSelection();
  const offset = (node: Node | null | undefined, at: number | undefined): number | null => {
    if (!node || at === undefined || !element.contains(node)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, at);
    return range.toString().length;
  };
  const anchor = offset(selection?.anchorNode, selection?.anchorOffset);
  const focus = offset(selection?.focusNode, selection?.focusOffset);
  for (const mark of element.querySelectorAll('.occ')) mark.replaceWith(...mark.childNodes);
  element.normalize();
  if (query) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node instanceof Text) nodes.push(node);
    for (const node of nodes) {
      const raw = node.data;
      if (!raw.includes(query)) continue;
      const fragment = document.createDocumentFragment();
      let at = 0,
        found;
      while ((found = raw.indexOf(query, at)) >= 0) {
        fragment.append(document.createTextNode(raw.slice(at, found)));
        const mark = document.createElement('span');
        mark.className = 'occ';
        mark.textContent = query;
        fragment.append(mark);
        at = found + query.length;
      }
      fragment.append(document.createTextNode(raw.slice(at)));
      node.replaceWith(fragment);
    }
  }
  function point(at: number): [Node, number] {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue;
      if (at <= node.length) return [node, at];
      at -= node.length;
    }
    return [element, element.childNodes.length];
  }
  if (selection && (anchor !== null || focus !== null)) {
    const start: [Node | null, number] =
      anchor === null ? [selection.anchorNode, selection.anchorOffset] : point(anchor);
    const end: [Node | null, number] =
      focus === null ? [selection.focusNode, selection.focusOffset] : point(focus);
    if (start[0] && end[0]) selection.setBaseAndExtent(start[0], start[1], end[0], end[1]);
  }
}
