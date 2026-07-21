// Tiny HTTP helpers built on Node's global fetch. Zero dependencies.
const UA = 'TrendPulse/0.1 (realtime trend dashboard; contact: you@example.com)';

export async function fetchText(url, opts = {}, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJSON(url, opts = {}, timeoutMs = 9000) {
  const text = await fetchText(url, opts, timeoutMs);
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

export function formPost(url, params, headers = {}) {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString(),
  });
}
