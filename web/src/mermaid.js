// Lazy, same-origin Mermaid rendering for fenced blocks in the Markdown preview.
// Repository Markdown is untrusted: only sanitized text reaches this module, and
// Mermaid's security-sensitive configuration cannot be changed by directives.

const MERMAID_ASSET = 'static/vendor/mermaid-12.0.0.min.js?v=12.0.0-2';
const MERMAID_SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'htmlLabels',
];

let mermaidRuntimePromise = null;
let mermaidRenderID = 0;
let mermaidLastThemeKey = null;

const MERMAID_ZOOM_LEVELS = [0.25, 0.35, 0.5, 0.65, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0];
const MERMAID_DEFAULT_ZOOM = 5; // index 5 is 1.0 (100%)
const MERMAID_ICON_EXPAND = 'icon-[lucide--maximize-2]';
const MERMAID_ICON_COLLAPSE = 'icon-[lucide--minimize-2]';

export function exitMermaidFullscreen() {
  const fs = /** @type {(HTMLElement & { __exitFullscreen?: () => void }) | null} */ (document.querySelector('.md-mermaid.is-fullscreen'));
  if (fs) {
    if (typeof fs.__exitFullscreen === 'function') {
      fs.__exitFullscreen();
    } else {
      fs.classList.remove('is-fullscreen');
      document.body.classList.remove('mermaid-fs-active');
    }
    return true;
  }
  return false;
}

// LRU cache for rendered SVG diagrams to eliminate redundant CPU/DOM work
// when switching tabs, scrolling, or toggling previews.
const MERMAID_CACHE_LIMIT = 150;
const mermaidSvgCache = new Map();

function getCachedSvg(key) {
  const svg = mermaidSvgCache.get(key);
  if (!svg) return null;
  mermaidSvgCache.delete(key);
  mermaidSvgCache.set(key, svg);
  return svg;
}

function setCachedSvg(key, svg) {
  if (mermaidSvgCache.has(key)) {
    mermaidSvgCache.delete(key);
  } else if (mermaidSvgCache.size >= MERMAID_CACHE_LIMIT) {
    const oldestKey = mermaidSvgCache.keys().next().value;
    if (oldestKey !== undefined) mermaidSvgCache.delete(oldestKey);
  }
  mermaidSvgCache.set(key, svg);
}

function getMermaidGlobal() {
  return globalThis.mermaid || (typeof window !== 'undefined' ? window.mermaid : null) || globalThis.__esbuild_esm_mermaid_nm?.mermaid?.default;
}

function loadMermaidRuntime() {
  const existing = getMermaidGlobal();
  if (existing) {
    globalThis.mermaid = existing;
    return Promise.resolve(existing);
  }
  if (mermaidRuntimePromise) return mermaidRuntimePromise;

  mermaidRuntimePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(MERMAID_ASSET, document.baseURI || location.href).href;
    script.async = true;
    script.addEventListener('load', () => {
      const m = getMermaidGlobal();
      if (m) {
        globalThis.mermaid = m;
        resolve(m);
      } else {
        reject(new Error('Mermaid runtime did not initialize'));
      }
    }, { once: true });
    script.addEventListener('error', () => {
      reject(new Error('Mermaid runtime could not be loaded'));
    }, { once: true });
    document.head.appendChild(script);
  }).catch(err => {
    mermaidRuntimePromise = null;
    throw err;
  });

  return mermaidRuntimePromise;
}

function mermaidColor(styles, name) {
  return styles.getPropertyValue(name).trim();
}

function getThemeKey() {
  const styles = getComputedStyle(document.documentElement);
  const dark = (styles.colorScheme || '').split(/\s+/).includes('dark');
  const theme = document.documentElement.dataset.theme || '';
  return `${theme}:${dark ? 'dark' : 'light'}`;
}

function mermaidConfig() {
  const styles = getComputedStyle(document.documentElement);
  const dark = (styles.colorScheme || '').split(/\s+/).includes('dark');
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    secure: MERMAID_SECURE_KEYS,
    suppressErrorRendering: true,
    htmlLabels: false,
    theme: 'base',
    themeVariables: {
      darkMode: dark,
      background: mermaidColor(styles, '--background'),
      primaryColor: mermaidColor(styles, '--sidebar'),
      primaryTextColor: mermaidColor(styles, '--foreground'),
      primaryBorderColor: mermaidColor(styles, '--border'),
      secondaryColor: mermaidColor(styles, '--muted'),
      secondaryTextColor: mermaidColor(styles, '--foreground'),
      secondaryBorderColor: mermaidColor(styles, '--border'),
      tertiaryColor: mermaidColor(styles, '--background'),
      tertiaryTextColor: mermaidColor(styles, '--muted-foreground'),
      tertiaryBorderColor: mermaidColor(styles, '--border'),
      lineColor: mermaidColor(styles, '--muted-foreground'),
      textColor: mermaidColor(styles, '--foreground'),
      mainBkg: mermaidColor(styles, '--sidebar'),
      nodeBorder: mermaidColor(styles, '--border'),
      clusterBkg: mermaidColor(styles, '--background'),
      clusterBorder: mermaidColor(styles, '--border'),
      edgeLabelBackground: mermaidColor(styles, '--background'),
      fontFamily: mermaidColor(styles, '--ui'),
    },
  };
}

function mermaidErrorMessage(err) {
  const text = String((err && err.message) ? err.message : (err || 'Unknown rendering error'));
  return text.split('\n', 1)[0].slice(0, 180);
}

function getSvgDimensions(svg) {
  let w = 0, h = 0;
  if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
    w = svg.viewBox.baseVal.width;
    h = svg.viewBox.baseVal.height;
  }
  if (!w || !h) {
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        w = parts[2];
        h = parts[3];
      }
    }
  }
  if (!w) {
    const styleMaxW = parseFloat(svg.style.maxWidth);
    if (styleMaxW > 0) w = styleMaxW;
  }
  if (!w || !h) {
    try {
      const bbox = svg.getBBox?.();
      if (bbox && bbox.width > 0) {
        w = bbox.width;
        h = bbox.height;
      }
    } catch {}
  }
  if (!w) w = parseFloat(svg.getAttribute('width')) || 600;
  if (!h) h = parseFloat(svg.getAttribute('height')) || 400;
  return { width: Math.max(20, w), height: Math.max(20, h) };
}

function getFitScale(output, naturalWidth, naturalHeight) {
  const availW = Math.max(100, output.clientWidth - 48);
  let fit = availW < naturalWidth ? availW / naturalWidth : 1.0;
  if (naturalHeight) {
    const availH = Math.max(100, output.clientHeight - 48);
    if (availH < naturalHeight) {
      fit = Math.min(fit, availH / naturalHeight);
    }
  }
  return Math.max(0.2, fit);
}

function mermaidZoomButton(label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.dataset.control = 'md-mermaid-zoom';
  button.dataset.variant = 'ghost';
  button.dataset.size = 'icon-xs';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<span class="${icon} size-3.5" aria-hidden="true"></span>`;
  return button;
}

function setupDiagramControlsAndPan(output, canvas, svg) {
  if (typeof output.__exitFullscreen === 'function') {
    output.__exitFullscreen();
  }

  const natural = getSvgDimensions(svg);
  let currentScale = 1.0;

  // If the diagram naturally overflows the container width, fit it initially
  const initialFit = getFitScale(output, natural.width);
  currentScale = initialFit;

  const controls = document.createElement('div');
  controls.className = 'md-mermaid-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Diagram zoom controls');

  const zoomOut = mermaidZoomButton('Zoom out diagram (or Ctrl+Scroll)', 'icon-[lucide--minus]');
  const labelBtn = document.createElement('button');
  labelBtn.type = 'button';
  labelBtn.className = 'btn';
  labelBtn.dataset.control = 'md-mermaid-zoom md-mermaid-zoom-label';
  labelBtn.dataset.variant = 'ghost';
  labelBtn.dataset.size = 'xs';
  labelBtn.title = 'Click to toggle 100% / Fit';
  labelBtn.setAttribute('aria-label', 'Toggle zoom');

  const zoomIn = mermaidZoomButton('Zoom in diagram (or Ctrl+Scroll)', 'icon-[lucide--plus]');
  const fitBtn = mermaidZoomButton('Fit diagram to view', 'icon-[lucide--scan]');
  const fullscreenBtn = mermaidZoomButton('Full screen', MERMAID_ICON_EXPAND);
  const closeBtn = mermaidZoomButton('Close full screen (Esc)', 'icon-[lucide--x]');
  closeBtn.classList.add('md-mermaid-fs-only');

  const fsClose = document.createElement('button');
  fsClose.type = 'button';
  fsClose.className = 'btn hidden [.is-fullscreen_&]:inline-flex fixed top-3 right-3 z-[1001]';
  fsClose.dataset.control = 'md-mermaid-fs-close';
  fsClose.dataset.variant = 'ghost';
  fsClose.dataset.size = 'icon-xs';
  fsClose.title = 'Close full screen (Esc)';
  fsClose.setAttribute('aria-label', 'Close full screen');
  fsClose.innerHTML = '<span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true"></span>';

  const setScale = (scale) => {
    currentScale = Math.max(0.2, Math.min(5.0, scale));
    const targetW = Math.round(natural.width * currentScale);
    const targetH = Math.round(natural.height * currentScale);
    svg.style.width = targetW + 'px';
    svg.style.height = targetH + 'px';
    svg.style.maxWidth = 'none';
    svg.style.minWidth = 'none';
    svg.style.flex = 'none';

    labelBtn.textContent = Math.round(currentScale * 100) + '%';
    zoomOut.disabled = currentScale <= MERMAID_ZOOM_LEVELS[0];
    zoomIn.disabled = currentScale >= MERMAID_ZOOM_LEVELS[MERMAID_ZOOM_LEVELS.length - 1];

    const hasOverflow = targetW > output.clientWidth - 48 || targetH > output.clientHeight - 48;
    output.classList.toggle('has-overflow', hasOverflow);
  };

  const zoomStep = (delta) => {
    let idx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < MERMAID_ZOOM_LEVELS.length; i++) {
      const diff = Math.abs(MERMAID_ZOOM_LEVELS[i] - currentScale);
      if (diff < minDiff) {
        minDiff = diff;
        idx = i;
      }
    }
    if (delta > 0) {
      if (MERMAID_ZOOM_LEVELS[idx] <= currentScale + 0.02 && idx < MERMAID_ZOOM_LEVELS.length - 1) {
        idx++;
      }
    } else if (delta < 0) {
      if (MERMAID_ZOOM_LEVELS[idx] >= currentScale - 0.02 && idx > 0) {
        idx--;
      }
    }
    setScale(MERMAID_ZOOM_LEVELS[idx]);
  };

  const setFullscreenIcon = (isFs) => {
    const icon = isFs ? MERMAID_ICON_COLLAPSE : MERMAID_ICON_EXPAND;
    const label = isFs ? 'Exit full screen (Esc)' : 'Full screen';
    fullscreenBtn.title = label;
    fullscreenBtn.setAttribute('aria-label', label);
    fullscreenBtn.innerHTML = `<span class="${icon} size-3.5" aria-hidden="true"></span>`;
  };

  const onFsKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitFullscreen();
    }
  };

  const onFsResize = () => {
    if (output.classList.contains('is-fullscreen')) {
      setScale(getFitScale(output, natural.width, natural.height));
    }
  };

  const enterFullscreen = () => {
    exitMermaidFullscreen();
    output.classList.add('is-fullscreen');
    document.body.classList.add('mermaid-fs-active');
    setFullscreenIcon(true);
    output.__exitFullscreen = exitFullscreen;
    window.addEventListener('keydown', onFsKeyDown, true);
    window.addEventListener('resize', onFsResize);
    requestAnimationFrame(() => {
      setScale(getFitScale(output, natural.width, natural.height));
      output.scrollLeft = Math.max(0, (output.scrollWidth - output.clientWidth) / 2);
      output.scrollTop = Math.max(0, (output.scrollHeight - output.clientHeight) / 2);
    });
  };

  const exitFullscreen = () => {
    output.classList.remove('is-fullscreen');
    document.body.classList.remove('mermaid-fs-active');
    setFullscreenIcon(false);
    delete output.__exitFullscreen;
    window.removeEventListener('keydown', onFsKeyDown, true);
    window.removeEventListener('resize', onFsResize);
    requestAnimationFrame(() => {
      setScale(getFitScale(output, natural.width));
      output.scrollLeft = 0;
      output.scrollTop = 0;
    });
  };

  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (output.classList.contains('is-fullscreen')) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exitFullscreen();
  });

  fsClose.addEventListener('click', (e) => {
    e.stopPropagation();
    exitFullscreen();
  });

  zoomOut.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomStep(-1);
  });

  zoomIn.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomStep(1);
  });

  labelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isFs = output.classList.contains('is-fullscreen');
    if (Math.abs(currentScale - 1.0) < 0.05) {
      setScale(getFitScale(output, natural.width, isFs ? natural.height : undefined));
    } else {
      setScale(1.0);
    }
  });

  fitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isFs = output.classList.contains('is-fullscreen');
    setScale(getFitScale(output, natural.width, isFs ? natural.height : undefined));
    output.scrollLeft = Math.max(0, (output.scrollWidth - output.clientWidth) / 2);
    output.scrollTop = Math.max(0, (output.scrollHeight - output.clientHeight) / 2);
  });

  // Double click toggles between 100% and Fit
  canvas.addEventListener('dblclick', (e) => {
    if (e.target.closest('.md-mermaid-controls')) return;
    e.preventDefault();
    const isFs = output.classList.contains('is-fullscreen');
    if (Math.abs(currentScale - 1.0) < 0.05) {
      setScale(getFitScale(output, natural.width, isFs ? natural.height : undefined));
    } else {
      setScale(1.0);
    }
  });

  // Ctrl/Cmd + Wheel to zoom
  output.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomStep(1);
      } else if (e.deltaY > 0) {
        zoomStep(-1);
      }
    }
  }, { passive: false });

  // Click and drag to pan when diagram overflows
  output.addEventListener('mousedown', (e) => {
    if (e.target.closest('.md-mermaid-controls') || e.button !== 0) return;
    if (output.scrollWidth > output.clientWidth || output.scrollHeight > output.clientHeight) {
      const startX = e.clientX;
      const startY = e.clientY;
      const scrollStartLeft = output.scrollLeft;
      const scrollStartTop = output.scrollTop;
      output.classList.add('panning');
      e.preventDefault();

      const onMove = (me) => {
        output.scrollLeft = scrollStartLeft - (me.clientX - startX);
        output.scrollTop = scrollStartTop - (me.clientY - startY);
      };
      const onUp = () => {
        output.classList.remove('panning');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  });

  controls.append(zoomOut, labelBtn, zoomIn, fitBtn, fullscreenBtn, closeBtn);
  output.prepend(controls);
  output.append(fsClose);
  setScale(currentScale);
}

function mermaidOutputFor(wrap) {
  let output = wrap.querySelector(':scope > .md-mermaid');
  if (!output) {
    output = document.createElement('div');
    output.className = 'md-mermaid';
    wrap.insertBefore(output, wrap.querySelector(':scope > pre'));
  }
  return output;
}

function mountDiagram(output, wrap, pre, svgCode) {
  const canvas = document.createElement('div');
  canvas.className = 'md-mermaid-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Mermaid diagram');
  canvas.innerHTML = svgCode;

  const svg = canvas.querySelector('svg');
  output.replaceChildren(canvas);
  output.removeAttribute('aria-busy');
  pre.hidden = true;
  wrap.classList.add('md-mermaid-ready');

  if (svg) {
    setupDiagramControlsAndPan(output, canvas, svg);
  }
}

/** Render every Mermaid fence under root. Returns false when the draw became stale. */
export async function renderMermaidBlocks(root, current = () => true) {
  const wraps = [...root.querySelectorAll('.md-pre[data-lang]')].filter(
    wrap => wrap.dataset.lang.toLowerCase() === 'mermaid'
  );
  if (!wraps.length) return true;

  const themeKey = getThemeKey();
  let runtime = null;

  for (const wrap of wraps) {
    if (!current()) return false;
    const pre = wrap.querySelector(':scope > pre');
    if (!pre) continue;
    const source = (pre.querySelector('code') || pre).textContent || '';
    const output = mermaidOutputFor(wrap);
    const cacheKey = `${themeKey}\n${source}`;
    const cachedSvg = getCachedSvg(cacheKey);

    // Fast-path: instantly reuse cached SVG layout without touching Mermaid runtime
    if (cachedSvg) {
      mountDiagram(output, wrap, pre, cachedSvg);
      continue;
    }

    // Lazy load runtime on the first uncached diagram
    if (!runtime) {
      try {
        runtime = await loadMermaidRuntime();
      } catch (err) {
        if (!current()) return false;
        for (const w of wraps) {
          const out = mermaidOutputFor(w);
          out.className = 'md-mermaid md-mermaid-error';
          out.removeAttribute('role');
          out.textContent = mermaidErrorMessage(err);
        }
        return true;
      }
      if (!current()) return false;
    }

    // Reconfigure theme variables only when theme changed
    if (mermaidLastThemeKey !== themeKey) {
      runtime.initialize(mermaidConfig());
      mermaidLastThemeKey = themeKey;
    }

    const id = `faah-mermaid-${++mermaidRenderID}`;
    output.className = 'md-mermaid';
    output.setAttribute('aria-busy', 'true');
    pre.hidden = false;
    wrap.classList.remove('md-mermaid-ready');

    try {
      const result = await runtime.render(id, source);
      if (!current()) return false;
      setCachedSvg(cacheKey, result.svg);
      mountDiagram(output, wrap, pre, result.svg);
    } catch (err) {
      if (!current()) return false;
      output.className = 'md-mermaid md-mermaid-error';
      output.removeAttribute('role');
      output.removeAttribute('aria-label');
      output.removeAttribute('aria-busy');
      output.textContent = 'Unable to render Mermaid diagram: ' + mermaidErrorMessage(err);
    } finally {
      document.getElementById('d' + id)?.remove();
    }

    // Yield cooperatively to the browser event loop so the UI remains fluid
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return true;
}
