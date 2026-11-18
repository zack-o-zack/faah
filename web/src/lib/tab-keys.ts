// Activate and focus the adjacent enabled tab. Solid owns the selection via onClick.
export function handleTabKeys(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]:not(:disabled):not([aria-disabled="true"])',
    ),
  ];
  if (!tabs.length) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.target;
  const active = tabs.findIndex(
    (tab) => tab === document.activeElement || (target instanceof Node && tab.contains(target)),
  );
  const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const current = active < 0 ? Math.max(0, selected) : active;
  let next = (current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  tabs[next]?.click();
  tabs[next]?.focus();
}
