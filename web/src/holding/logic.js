export function holdingUpdate(items, path) {
  const item = items.find(item => item.href === path);
  return !item || item.state !== 'starting' ? { reload: true } : { reload: false, progress: item.progress };
}
