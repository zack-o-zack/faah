// Shared search and navigation for Solid-owned lists.
export function filterByText<T>(items: T[], query: string, label: (item: T) => string): T[] {
  const needle = query.toLowerCase();
  return items.filter((item) => label(item).toLowerCase().includes(needle));
}

export function moveListIndex(index: number, delta: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index + delta));
}

export function scrollToItem(
  top: number,
  height: number,
  itemTop: number,
  itemHeight: number,
): number {
  if (itemTop < top) return itemTop;
  if (itemTop + itemHeight > top + height) return itemTop + itemHeight - height;
  return top;
}
