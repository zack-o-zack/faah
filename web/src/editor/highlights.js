import { onCleanup } from 'solid-js';

export function createHighlights() {
  const groups = new Map();
  const owners = new Map();
  function remove(owner) {
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
    update(owner, marks) {
      remove(owner);
      if (!globalThis.Highlight || !globalThis.CSS?.highlights) return;
      owners.set(owner, marks);
      for (const [name, ranges] of marks) {
        if (!groups.has(name)) {
          const group = new Highlight();
          groups.set(name, group);
          CSS.highlights.set(name, group);
        }
        for (const range of ranges) groups.get(name).add(range);
      }
    },
  };
}
export function textRanges(element, query, caseSensitive = true) {
  if (!query) return [];
  const text = element.textContent;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const nodes = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  function point(offset) {
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
