/** Keep a two-state control's visual and accessible state together. */
export function setPressed(control, pressed) {
  if (!control) return;
  control.setAttribute('aria-pressed', String(!!pressed));
  if (control.getAttribute('role') === 'tab') control.setAttribute('aria-selected', String(!!pressed));
  // Grouped segments keep their outline so the group reads as one control.
  const off = control.closest?.('.button-group') ? 'outline' : 'ghost';
  control.dataset.variant = pressed ? 'secondary' : off;
}

/** Let focused controls own ordinary navigation; editor shortcuts keep modifiers. */
export function ownsNavigationKey(event) {
  return !event.metaKey && !event.ctrlKey && !event.altKey &&
    ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ' ', 'Enter'].includes(event.key) &&
    !!event.target?.closest?.('button, a[href], select, [role="button"], [role="tab"], [role^="menuitem"]');
}
