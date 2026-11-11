/** Keep a two-state control's visual and accessible state together. */
export function setPressed(control, pressed) {
  if (!control) return;
  control.setAttribute('aria-pressed', String(!!pressed));
  if (control.getAttribute('role') === 'tab') control.setAttribute('aria-selected', String(!!pressed));
  control.dataset.variant = pressed ? 'secondary' : 'ghost';
}
