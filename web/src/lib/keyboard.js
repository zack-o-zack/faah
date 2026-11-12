export const detectMac = platform => /mac|iphone|ipad/i.test(platform || '');
export const isMac = detectMac(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform);
const MAC_KEYS = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↩', Left: '←', Right: '→', Up: '↑', Down: '↓' };
const PC_KEYS = { Mod: 'Ctrl', Left: '←', Right: '→', Up: '↑', Down: '↓' };
export const keyParts = (combo, mac = isMac) => {
  const value = combo.includes('|') ? combo.split('|')[mac ? 1 : 0] : combo;
  return value ? value.split('+').map(k => (mac ? MAC_KEYS : PC_KEYS)[k] || k) : [];
};
export function keyLabel(combo, mac = isMac) {
  const parts = keyParts(combo, mac);
  if (!mac) return parts.join('+');
  const key = parts.pop() || '';
  return parts.join('') + (parts.length && /^[a-z]{2,}$/i.test(key) ? ' ' : '') + key;
}
export const keyCaps = (combo, mac = isMac) => keyParts(combo, mac);
export const withKeys = (text, mac = isMac) => text.replace(/\{([^}]+)\}/g, (_, combo) => keyLabel(combo, mac));
export function matchesShortcut(event, combo, mac = isMac) {
  const variant = combo.includes('|') ? combo.split('|')[mac ? 1 : 0] : combo;
  if (!variant) return false;
  const parts = variant.toLowerCase().split('+');
  const key = parts.pop();
  const eventKey = key === '.' && event.shiftKey && (event.code === 'Period' || event.key === '>') ? '.' : event.key.toLowerCase();
  return eventKey === key &&
    event.metaKey === (parts.includes('meta') || (mac && parts.includes('mod'))) &&
    event.ctrlKey === (parts.includes('ctrl') || (!mac && parts.includes('mod'))) &&
    event.shiftKey === parts.includes('shift') && event.altKey === parts.includes('alt');
}
