const TITLE_BAR_HEIGHT = 38;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// macOS and Windows draw their window controls over the app's own top bar.
// Linux keeps the system frame: tiling window managers and Wayland compositors
// each treat custom title bars differently.
function chromeOptions(platform) {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } };
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#111113', symbolColor: '#cdd6f4', height: TITLE_BAR_HEIGHT },
    };
  }
  return {};
}

// Themes are user-editable CSS, so only plain hex colors reach the native window.
function chromeColors(value) {
  if (!HEX_COLOR.test(value?.color) || !HEX_COLOR.test(value?.symbolColor)) return null;
  return { color: value.color, symbolColor: value.symbolColor };
}

function menuPoint(value) {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) return null;
  return { x: Math.round(value.x), y: Math.round(value.y) };
}

module.exports = { chromeOptions, chromeColors, menuPoint };
