/** Prepare a Basecoat panel while leaving positioning and actions to its owner. */
export function prepareMenu(panel) {
  if (!panel || panel.hasAttribute('data-popover')) return;
  const wrapper = document.createElement('div');
  // The panel is fixed, so its wrapper takes no room in the page.
  wrapper.className = 'dropdown-menu contents';
  panel.before(wrapper);
  wrapper.append(panel);
  panel.setAttribute('data-popover', '');
  panel.className = 'fixed min-w-[190px] max-w-[min(380px,95vw)] z-[70] top-auto left-auto m-0 gap-0';
  panel.setAttribute('aria-hidden', String(panel.hidden));
  const navigate = e => {
    if (panel.hidden || panel.getAttribute('aria-hidden') === 'true') return;
    if (document.querySelector('dialog[open]')) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...panel.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const i = items.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[n].focus();
  };
  document.addEventListener('keydown', navigate, { capture: true });
}

export function setMenuHidden(panel, hidden) {
  if (!panel) return;
  prepareMenu(panel);
  panel.hidden = hidden;
  panel.setAttribute('aria-hidden', String(hidden));
  const triggers = { 'lsp-menu': '#st-lsp', 'metrics-menu': '#st-metrics', 'pr-merge-menu': '#pr-merge-caret', 'wb-theme-menu': '#btn-theme' };
  const trigger = triggers[panel.id] && document.querySelector(triggers[panel.id]);
  trigger?.setAttribute('aria-expanded', String(!hidden));
  for (const item of panel.querySelectorAll('button')) {
    if (!item.hasAttribute('role')) item.setAttribute('role', 'menuitem');
    item.classList.remove('btn');
  }
}
