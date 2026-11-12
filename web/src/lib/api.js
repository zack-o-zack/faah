const request = async (method, path, params, opts = {}) => {
  const relPath = path.startsWith('/') ? path.slice(1) : path;
  const base = document.baseURI || (typeof location !== 'undefined' && (location.origin ? location.origin + '/' : location.href)) || 'http://localhost:7777/';
  const u = new URL(relPath, base);
  /** @type {RequestInit} */
  const fetchOpts = { method, ...opts };
  const isPost = method === 'POST' || method === 'PUT' || method === 'PATCH';

  if (params) {
    const hasComplex = typeof params === 'object' && params !== null && (
      Array.isArray(params) || Object.values(params).some(v => typeof v === 'object' && v !== null)
    );
    if (isPost && (opts.json || hasComplex)) {
      fetchOpts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      fetchOpts.body = JSON.stringify(params);
    } else {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') u.searchParams.set(k, v);
      }
    }
  }

  if (!fetchOpts.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    fetchOpts.signal = AbortSignal.timeout(opts.timeout || 30000);
  }

  const r = await fetch(u, fetchOpts);
  const j = await r.json();
  // The body rides along: some replies, like a failed agent job, carry detail beyond the message.
  if (j.error) throw Object.assign(new Error(j.error), { body: j });
  return j;
};
export const api = (path, params, opts) => request('GET', path, params, opts);
// For requests that change the machine; the server only accepts these as POST from this page.
export const apiPost = (path, params, opts) => request('POST', path, params, opts);
export const apiPostJson = (path, params, opts) => request('POST', path, params, { json: true, ...opts });
