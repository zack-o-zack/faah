interface Size {
  width: number;
  height: number;
}
const ZOOM_LEVELS = [0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export function diagramDimensions(markup: string): Size {
  const root = /<svg\b[^>]*>/i.exec(markup)?.[0] || '';
  const box = /\bviewBox=["']([^"']+)["']/i
    .exec(root)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && (box[2] ?? 0) > 0 && (box[3] ?? 0) > 0)
    return { width: Math.max(20, box[2] ?? 0), height: Math.max(20, box[3] ?? 0) };
  const width = parseFloat(/\bwidth=["']([\d.]+)(?:px)?["']/i.exec(root)?.[1] || '') || 600;
  const height = parseFloat(/\bheight=["']([\d.]+)(?:px)?["']/i.exec(root)?.[1] || '') || 400;
  return { width: Math.max(20, width), height: Math.max(20, height) };
}

export function diagramFit(natural: Size, size: Size, fullscreen: boolean): number {
  const width = Math.max(100, size.width - 48) / natural.width;
  const height = fullscreen ? Math.max(100, size.height - 48) / natural.height : 1;
  return Math.max(0.2, Math.min(1, width, height));
}

export function diagramZoom(scale: number, direction: number): number {
  let index = 0;
  for (let i = 1; i < ZOOM_LEVELS.length; i++)
    if (Math.abs((ZOOM_LEVELS[i] ?? 1) - scale) < Math.abs((ZOOM_LEVELS[index] ?? 1) - scale))
      index = i;
  if (direction > 0 && (ZOOM_LEVELS[index] ?? 1) <= scale + 0.02) index++;
  if (direction < 0 && (ZOOM_LEVELS[index] ?? 1) >= scale - 0.02) index--;
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index))] ?? 1;
}
