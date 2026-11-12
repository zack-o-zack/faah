export function placeCard(point, host, card) {
  let left = point.x - host.left + 6;
  let top = point.y - host.top + 20;
  if (left + card.width > host.width - 12) left = Math.max(8, host.width - card.width - 12);
  if (top + card.height > host.height - 8) {
    const above = point.y - host.top - card.height - 12;
    top = above > 8 ? above : Math.max(8, host.height - card.height - 8);
  }
  return { left, top };
}

export function nearCard(point, anchor, rect, pad = 16, corridor = 52) {
  if (!point) return false;
  if (
    point.x >= rect.left - pad &&
    point.x <= rect.right + pad &&
    point.y >= rect.top - pad &&
    point.y <= rect.bottom + pad
  )
    return true;
  if (!anchor) return false;
  return (
    point.x >= Math.min(anchor.x, rect.left) - corridor &&
    point.x <= Math.max(anchor.x, rect.right) + corridor &&
    point.y >= Math.min(anchor.y, rect.top) - corridor &&
    point.y <= Math.max(anchor.y, rect.bottom) + corridor
  );
}
