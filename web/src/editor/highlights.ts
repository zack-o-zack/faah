import { onCleanup } from 'solid-js';

export function createHighlights() {
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
