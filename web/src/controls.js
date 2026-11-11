/** Keep a two-state control's visual and accessible state together. */
export function setPressed(control, pressed) {
  if (!control) return;
  control.setAttribute('aria-pressed', String(!!pressed));
  if (control.getAttribute('role') === 'tab') control.setAttribute('aria-selected', String(!!pressed));
  control.dataset.variant = pressed ? 'secondary' : 'ghost';
}

/** Let focused controls own ordinary navigation; editor shortcuts keep modifiers. */
export function ownsNavigationKey(event) {
  return !event.metaKey && !event.ctrlKey && !event.altKey &&
    ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'Enter'].includes(event.key) &&
    !!event.target?.closest?.('button, a[href], select, [role="button"], [role="tab"], [role^="menuitem"]');
}
