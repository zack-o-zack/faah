import { currentTheme, setTheme } from './theme.js';

setTheme(currentTheme(), false);

// Poll without replacing the document, so the CSS spinner keeps rotating.
const holdingProgress = document.querySelector('#wb-holding-progress');
const holdingPath = location.pathname;

async function pollHolding() {
  try {
    const response = await fetch('api/wb/state', {
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Workspace status is unavailable');
    const state = await response.json();
    const item = state.items.find(item => item.href === holdingPath);
    if (!item || item.state !== 'starting') {
      location.replace(location.href);
      return;
    }
    if (holdingProgress && item.progress) holdingProgress.textContent = item.progress + '…';
  } catch {
    // Keep the page and animation intact through a temporary connection error.
  }
  setTimeout(pollHolding, 1000);
}

if (holdingProgress) void pollHolding();
