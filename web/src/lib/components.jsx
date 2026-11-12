import { createEffect, createSignal, createUniqueId, For, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

export function Select(props) {
  return <select class="select" aria-label={props.label} value={props.value} disabled={props.disabled} onChange={e => props.onChange(e.currentTarget.value)}>
    <For each={props.options}>{option => <option value={option.value}>{option.label}</option>}</For>
  </select>;
}

export function Popover(props) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  let trigger, panel;
  const close = (reason = 'dismiss') => { setOpen(false); trigger?.focus(); props.onClose?.(reason); };
  const outside = e => { if (open() && !panel?.contains(e.target) && !trigger?.contains(e.target)) { setOpen(false); props.onClose?.('dismiss'); } };
  const key = e => {
    if (!open()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && props.role === 'menu') {
      const items = [...panel.querySelectorAll('[role^="menuitem"]:not([disabled])')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
    }
  };
  onMount(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); });
  onCleanup(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); });
  return <div class="dropdown-menu relative inline-block">
    <button ref={trigger} type="button" class="btn" aria-haspopup={props.role || 'dialog'} aria-expanded={open()} aria-controls={id} onClick={() => { if (open()) close(); else { props.onOpen?.(); setOpen(true); } }}>{props.label}</button>
    <Show when={open()}><div ref={el => { panel = el; queueMicrotask(() => el.querySelector('button, input, [tabindex="0"]')?.focus()); }} id={id} role={props.role || 'dialog'} aria-label={props.label} data-popover class="absolute bottom-full right-0 z-50 mb-1 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground" onClick={e => { if (props.role === 'menu' && e.target.closest('[role^="menuitem"]')) close('select'); }}>
      {typeof props.children === 'function' ? props.children(close) : props.children}
    </div></Show>
  </div>;
}
export function DropdownMenu(props) {
  return <Popover label={props.label} role="menu" onOpen={props.onOpen} onClose={props.onClose}>{props.children}</Popover>;
}
export function ContextMenu(props) {
  const [point, setPoint] = createSignal(null);
  let panel, previous;
  const close = () => { setPoint(null); props.onClose?.(); previous?.focus(); };
  const key = e => {
    if (!point()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      const items = [...panel.querySelectorAll('[role^="menuitem"]:not([disabled])')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
    }
  };
  const outside = e => { if (!panel?.contains(e.target)) close(); };
  onMount(() => { document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside); });
  onCleanup(() => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); });
  return <div onContextMenu={e => { e.preventDefault(); previous = document.activeElement; setPoint({ x: e.clientX, y: e.clientY }); }} onKeyDown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); previous = document.activeElement; const r = e.currentTarget.getBoundingClientRect(); setPoint({ x: r.left, y: r.top }); } }}>
    {props.children}<Show when={point()}><Portal><div ref={el => { panel = el; queueMicrotask(() => el.querySelector('button')?.focus()); }} class="dropdown-menu fixed z-50 border bg-popover p-1" role="menu" aria-label={props.label} style={{ left: `${point().x}px`, top: `${point().y}px` }} onClick={close}>{props.menu}</div></Portal></Show>
  </div>;
}
export function Dialog(props) {
  let dialog, previous;
  const title = createUniqueId();
  createEffect(() => {
    if (props.open) { previous = document.activeElement; dialog.showModal(); }
    else if (dialog.open) { dialog.close(); previous?.focus(); }
  });
  onCleanup(() => { dialog.close(); previous?.focus(); });
  return <Portal><dialog ref={dialog} class="dialog" aria-labelledby={title} onCancel={e => { e.preventDefault(); props.onClose(); }} onClick={e => { if (e.target === dialog) props.onClose(); }}>
    <section><header><h2 id={title}>{props.title}</h2></header>{props.children}<button type="button" class="btn" onClick={() => props.onClose()}>Close</button></section>
  </dialog></Portal>;
}
export function Tooltip(props) {
  const [shown, setShown] = createSignal(false);
  const id = createUniqueId();
  return <span class="relative" onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)} onFocusIn={() => setShown(true)} onFocusOut={() => setShown(false)} onKeyDown={e => { if (e.key === 'Escape') setShown(false); }}>
    {props.children({ 'aria-describedby': id })}
    <Show when={shown()}><span id={id} role="tooltip" class="tooltip absolute bottom-full bg-popover p-2 text-popover-foreground">{props.text}</span></Show>
  </span>;
}
export function SplitHandle(props) {
  let release = () => {};
  onCleanup(() => release());
  const change = delta => props.onChange(Math.max(props.min ?? 0, Math.min(props.max ?? Infinity, props.value + delta)));
  return <div role="separator" tabindex="0" aria-label={props.label} aria-orientation={props.vertical ? 'horizontal' : 'vertical'} aria-valuenow={props.value} aria-valuemin={props.min ?? 0} aria-valuemax={props.max} class="split-handle" style={{ 'touch-action': 'none', cursor: props.vertical ? 'row-resize' : 'col-resize' }} onKeyDown={e => {
    if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); change((e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 40 : 10)); }
  }} onPointerDown={e => {
    if (e.button !== 0) return;
    release(); e.preventDefault();
    let last = props.vertical ? e.clientY : e.clientX;
    const move = e => { const at = props.vertical ? e.clientY : e.clientX; change(at - last); last = at; };
    release = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', release); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', release); document.addEventListener('pointercancel', release);
  }} />;
}
