// A shared agent → model picker. The native popover escapes clipped panels
// and supplies outside-click/Escape dismissal without taking over the editor.
export function groupAgentModels(harnesses) {
  return harnesses.filter(h => h.installed).map(h => ({
    key: h.name,
    harness: h.name,
    models: (h.models || []).map(model => ({
      value: model,
      label: model,
    })),
  }));
}

export function filterAgentModels(groups, query) {
  const words = query.toLowerCase().trim().split(/\s+/);
  return groups.map(g => ({ ...g, models: g.models.filter(m => words.every(w =>
    `${g.harness} ${m.label}`.toLowerCase().includes(w))) })).filter(g => g.models.length);
}

let agentPickerSeq = 0;
const agentPickerStates = new WeakMap();

export function updateAgentPicker(root, { harnesses, harness, model, pinned, busy, loadModels }) {
  let state = agentPickerStates.get(root);
  if (!state) {
    state = createAgentPicker(root);
    agentPickerStates.set(root, state);
  }
  state.loadModels = loadModels;
  state.groups = groupAgentModels(harnesses).map(g => ({ ...g,
    models: g.models.length ? g.models : (state.requests.get(g.harness)?.models || []).map(model => ({ value: model, label: model })),
  }));
  state.harness = harness;
  state.model = model;
  state.pinned = pinned;
  const trigger = root.querySelector(':scope > button');
  trigger.disabled = busy || !state.groups.length;
  trigger.querySelector('span').textContent = harness ? (model ? `${harness} · ${model}` : harness) : 'No harness';
  trigger.title = pinned ? 'Harness fixed for this run by -agent' : 'Choose agent and model';
  root.value = JSON.stringify([harness || '', model || '']);
  if (trigger.disabled && state.panel.matches(':popover-open')) state.panel.hidePopover();
  if (state.panel.matches(':popover-open')) state.render();
}

function createAgentPicker(root) {
  const trigger = root.querySelector(':scope > button');
  const id = `agent-models-${++agentPickerSeq}`;
  const panel = document.createElement('div');
  panel.className = 'fixed m-0 overflow-hidden rounded-lg border bg-popover p-0 text-popover-foreground shadow-lg';
  panel.style.width = 'min(36rem, calc(100vw - 24px))';
  panel.setAttribute('popover', 'auto');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Choose agent and model');
  panel.id = id;
  panel.innerHTML = `<div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <nav aria-label="Agents" class="min-h-0 min-w-0 overflow-y-auto overscroll-contain border-r bg-sidebar p-1.5"></nav>
      <section class="flex min-h-0 min-w-0 flex-col">
        <header class="mx-3 flex shrink-0 items-center gap-2 border-b py-3 focus-within:border-primary">
          <span class="icon-[lucide--search] size-4 shrink-0 text-muted-foreground" aria-hidden="true"></span>
          <input type="search" class="min-w-0 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" placeholder="Search models…" aria-label="Search models" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${id}-list">
        </header>
        <h2 class="shrink-0 truncate px-3 py-2 text-xs text-muted-foreground">Models</h2>
        <div role="listbox" aria-label="Models" id="${id}-list" class="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-py-2 px-1.5 pb-2"></div>
        <div class="px-3 py-2 text-sm text-muted-foreground" role="status" hidden></div>
      </section>
    </div>`;
  root.append(panel);
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-haspopup', 'dialog');
  const search = panel.querySelector('input');
  const nav = panel.querySelector('nav');
  const list = panel.querySelector('[role=listbox]');
  const status = panel.querySelector('[role=status]');
  const grid = panel.querySelector('.grid');
  const state = { panel, requests: new Map(), groups: [], active: '', index: 0, visible: [], render };
  const rowClass = 'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-accent aria-selected:text-accent-foreground';
  const selected = (g, m) => g.harness === state.harness && m.value === state.model;
  function activate(index) {
    state.index = Math.max(0, Math.min(index, state.visible.length - 1));
    [...list.children].forEach((el, i) => {
      el.classList.toggle('bg-accent', i === state.index);
      if (i === state.index) {
        search.setAttribute('aria-activedescendant', el.id);
        el.scrollIntoView({ block: 'nearest' });
      }
    });
    if (!state.visible.length) search.removeAttribute('aria-activedescendant');
  }
  function choose(g, m) {
    if (state.pinned && g.harness !== state.harness) return;
    root.value = JSON.stringify([g.harness, m.value]);
    panel.hidePopover();
    trigger.focus();
    root.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function render() {
    const groups = state.groups;
    const active = groups.find(g => g.key === state.active) || groups[0];
    state.active = active?.key;
    nav.replaceChildren();
    for (const g of groups) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = rowClass + ' flex-col items-start! gap-0.5!';
      button.setAttribute('aria-pressed', String(g === active));
      if (g === active) button.classList.add('bg-primary/10', 'text-primary-text');
      button.disabled = state.pinned && g.harness !== state.harness;
      button.classList.add('disabled:opacity-50');
      const name = document.createElement('span');
      name.className = 'w-full truncate';
      name.textContent = g.harness;
      button.append(name);

      button.onclick = () => { state.active = g.key; search.value = ''; render(); search.focus(); };
      nav.append(button);
    }
    panel.querySelector('h2').textContent = active ? `${active.harness} models` : 'No models found';
    list.replaceChildren();
    state.visible = filterAgentModels(active ? [active] : [], search.value)[0]?.models || [];
    for (const [i, m] of state.visible.entries()) {
      const option = document.createElement('div');
      option.id = `${id}-option-${i}`;
      option.className = rowClass + ' cursor-pointer aria-selected:bg-primary/10! aria-selected:text-primary-text!';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(selected(active, m)));
      option.setAttribute('aria-disabled', String(!!state.pinned && active.harness !== state.harness));
      option.title = m.value || 'Use the harness default';
      const label = document.createElement('span');
      label.className = 'min-w-0 flex-1 truncate';
      label.textContent = m.label;
      option.append(label);
      if (selected(active, m)) {
        const check = document.createElement('span');
        check.className = 'icon-[lucide--check] size-3.5 shrink-0';
        check.setAttribute('aria-hidden', 'true');
        option.append(check);
      }
      option.onclick = () => choose(active, m);
      list.append(option);
    }
    if (active && !active.models.length && !state.requests.has(active.harness)) {
      const request = { loading: true };
      state.requests.set(active.harness, request);
      state.loadModels(active.harness).then(models => {
        request.models = models;
        const group = state.groups.find(g => g.harness === active.harness);
        if (group) group.models = models.map(model => ({ value: model, label: model }));
      }).catch(error => { request.error = error.message; }).finally(() => {
        request.loading = false;
        if (panel.matches(':popover-open') && root.isConnected) render();
      });
    }
    const request = state.requests.get(active?.harness);
    status.hidden = state.visible.length > 0;
    status.textContent = request?.loading ? 'Loading models…' : request?.error ? `Could not load models: ${request.error}` : search.value ? 'No matching models' : 'No models reported by this agent';
    if (request?.error) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn mt-2';
      retry.dataset.variant = 'outline';
      retry.dataset.size = 'sm';
      retry.textContent = 'Retry';
      retry.onclick = () => { state.requests.delete(active.harness); render(); };
      status.append(retry);
    }
    if (state.pinned) panel.querySelector('h2').textContent += ' · Harness fixed';
    nav.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest' });
    const current = state.visible.findIndex(m => selected(active, m));
    activate(current < 0 ? 0 : current);
  }
  function position() {
    const r = trigger.getBoundingClientRect();
    const host = root.closest('aside, dialog')?.getBoundingClientRect();
    const left = Math.max(12, host ? host.left + 12 : 12);
    const right = Math.min(innerWidth - 12, host ? host.right - 12 : innerWidth - 12);
    const top = Math.max(12, host ? host.top + 12 : 12);
    const bottom = Math.min(innerHeight - 12, host ? host.bottom - 12 : innerHeight - 12);
    panel.style.width = `${Math.max(0, Math.min(576, right - left))}px`;
    const above = r.top - top;
    const below = bottom - r.bottom;
    const up = above > below;
    const available = Math.max(0, (up ? above : below) - 6);
    grid.style.height = `${Math.max(0, Math.min(360, available - 2))}px`;
    panel.style.maxHeight = `${available}px`;
    panel.style.left = `${Math.max(left, Math.min(r.left, right - panel.offsetWidth))}px`;
    panel.style.top = `${up ? Math.max(top, r.top - panel.offsetHeight - 6) : r.bottom + 6}px`;
  }
  trigger.addEventListener('click', () => {
    if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
    search.value = '';
    state.active = state.groups.find(g => g.harness === state.harness && g.models.some(m => m.value === state.model))?.key;
    panel.showPopover();
    position();
    render();
    search.focus();
  });
  const dismissOnResize = () => { if (panel.matches(':popover-open')) panel.hidePopover(); };
  const hostObserver = new ResizeObserver(() => { if (panel.matches(':popover-open')) position(); });
  panel.addEventListener('toggle', () => {
    const open = panel.matches(':popover-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      window.addEventListener('resize', dismissOnResize);
      const host = root.closest('aside, dialog');
      if (host) hostObserver.observe(host);
    } else {
      window.removeEventListener('resize', dismissOnResize);
      hostObserver.disconnect();
    }
  });
  search.addEventListener('input', render);
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); panel.hidePopover(); trigger.focus(); }
  });
  search.addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(e.key) || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      const g = state.groups.find(g => g.key === state.active);
      const m = state.visible[state.index];
      if (g && m) choose(g, m);
    } else activate(e.key === 'Home' ? 0 : e.key === 'End' ? state.visible.length - 1 : state.index + (e.key === 'ArrowDown' ? 1 : -1));
  });
  // Close on geometry changes; the next opening is anchored to the new position.
  return state;
}
