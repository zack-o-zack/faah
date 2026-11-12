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

function getMermaidGlobal() {
  return (
    globalThis.mermaid ||
    (typeof window !== 'undefined' ? window.mermaid : null) ||
    globalThis.__esbuild_esm_mermaid_nm?.mermaid?.default
  );
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
    script.addEventListener(
      'load',
      () => {
        const m = getMermaidGlobal();
        if (m) {
          globalThis.mermaid = m;
          resolve(m);
        } else {
          reject(new Error('Mermaid runtime did not initialize'));
        }
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        reject(new Error('Mermaid runtime could not be loaded'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((err) => {
    mermaidRuntimePromise = null;
    throw err;
  });

  return mermaidRuntimePromise;
}

function mermaidColor(styles, name) {
  return styles.getPropertyValue(name).trim();
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

const cache = new Map();
let queue = Promise.resolve();
export async function renderDiagram(source, theme) {
  const key = theme + ':' + source;
  if (cache.has(key)) return cache.get(key);
  const task = queue
    .catch(() => {})
    .then(async () => {
      const runtime = await loadMermaidRuntime();
      runtime.initialize(mermaidConfig());
      const id = 'faah-mermaid-' + ++mermaidRenderID;
      try {
        const result = await runtime.render(id, source);
        if (cache.size >= 50) cache.delete(cache.keys().next().value);
        cache.set(key, result.svg);
        return result.svg;
      } finally {
        document.getElementById('d' + id)?.remove();
      }
    });
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
