interface Point {
  x: number;
  y: number;
}
export function fitScale(
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
  padding = 80,
): number {
  if (!width || !height) return 1;
  return Math.max(
    0.05,
    Math.min(1, (viewWidth - padding) / width, (viewHeight - padding) / height),
  );
}
export function zoomScale(scale: number, direction: number, factor = 1.25): number {
  return Math.max(0.05, Math.min(32, direction > 0 ? scale * factor : scale / factor));
}
export function panFrom(
  origin: { panX: number; panY: number },
  start: Point,
  current: Point,
): { panX: number; panY: number } {
  return { panX: origin.panX + current.x - start.x, panY: origin.panY + current.y - start.y };
}
export function imageTransform(
  view: { panX: number; panY: number; fit: boolean; scale: number },
  fitted: number,
): string {
  return `translate(${view.panX}px, ${view.panY}px) scale(${view.fit ? fitted : view.scale})`;
}
