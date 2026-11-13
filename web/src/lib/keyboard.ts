export const detectMac = (platform: string | undefined): boolean =>
  /mac|iphone|ipad/i.test(platform || '');
export const isMac = detectMac(
  (globalThis.navigator &&
  'userAgentData' in globalThis.navigator &&
  typeof globalThis.navigator.userAgentData === 'object' &&
  globalThis.navigator.userAgentData &&
  'platform' in globalThis.navigator.userAgentData &&
  typeof globalThis.navigator.userAgentData.platform === 'string'
    ? globalThis.navigator.userAgentData.platform
    : '') || globalThis.navigator?.platform,
);
const MAC_KEYS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Enter: '↩',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
};
const PC_KEYS: Record<string, string> = { Mod: 'Ctrl', Left: '←', Right: '→', Up: '↑', Down: '↓' };
export const keyParts = (combo: string, mac = isMac): string[] => {
  const value = combo.includes('|') ? combo.split('|')[mac ? 1 : 0] || '' : combo;
  return value ? value.split('+').map((k) => (mac ? MAC_KEYS : PC_KEYS)[k] || k) : [];
};
export function keyLabel(combo: string, mac = isMac): string {
  const parts = keyParts(combo, mac);
  if (!mac) return parts.join('+');
  const key = parts.pop() || '';
  return parts.join('') + (parts.length && /^[a-z]{2,}$/i.test(key) ? ' ' : '') + key;
}
export const keyCaps = keyParts;
export const withKeys = (text: string, mac = isMac): string =>
  text.replace(/\{([^}]+)\}/g, (_, combo) => keyLabel(combo, mac));
export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'> & {
    code?: string;
  },
  combo: string,
  mac = isMac,
): boolean {
  const variant = combo.includes('|') ? combo.split('|')[mac ? 1 : 0] || '' : combo;
  if (!variant) return false;
  const parts = variant.toLowerCase().split('+');
  const name = parts.pop() || '';
  const aliases: Record<string, string> = {
    left: 'arrowleft',
    right: 'arrowright',
    up: 'arrowup',
    down: 'arrowdown',
  };
  const key = aliases[name] || name;
  const eventKey =
    key === '.' && event.shiftKey && (event.code === 'Period' || event.key === '>')
      ? '.'
      : event.key.toLowerCase();
  const codeKey = event.code?.replace(/^(Key|Digit)/, '').toLowerCase();
  const actual = event.altKey && /^[a-z0-9]$/.test(key) && codeKey ? codeKey : eventKey;
  return (
    actual === key &&
    event.metaKey === (parts.includes('meta') || (mac && parts.includes('mod'))) &&
    event.ctrlKey === (parts.includes('ctrl') || (!mac && parts.includes('mod'))) &&
    event.shiftKey === parts.includes('shift') &&
    event.altKey === parts.includes('alt')
  );
}
