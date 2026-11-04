'use strict';

const HEALTH_TIMEOUT_MS = 2500;   
const GIST_MAX_AGE_MS = 15 * 60 * 1000;
const GIST_TIMEOUT_MS = 8000;

let cachedChatUrl = null;
let healthCache = { ok: null, reason: null, checkedAt: 0 };

function reset() {
  cachedChatUrl = null;
  healthCache = { ok: null, reason: null, checkedAt: 0 };
}

function isConfigured() {
  return !!(
    process.env.SKRITIMAI_URL || 
    process.env.SKRITIMAI_BASE_URL || 
    process.env.SKRITIMAI_GIST_ID || 
    process.env.SKRITIMAI_GIST_URL
  );
}

function getApiKey() { return process.env.SKRITIMAI_API_KEY || ''; }

function buildHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

function buildChatUrl(base) {
  const b = String(base).replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

function buildModelsUrl(chatUrl) {
  return chatUrl.replace(/\/chat\/completions$/, '') + '/models';
}

async function readGistState(gistId, gistUrl) {
  const ghToken = process.env.SKRITIMAI_GIST_TOKEN || process.env.GITHUB_TOKEN;

  if (gistId) {
    const url = `https://api.github.com/gists/${encodeURIComponent(gistId)}`;
    const headers = { 'User-Agent': 'ariotica', Accept: 'application/vnd.github+json' };
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(GIST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Gist fetch failed: HTTP ${res.status}`);

    const data = await res.json();
    const files = data.files || {};
    const f = files['engine.json'] || Object.values(files)[0];
    if (!f?.content) throw new Error('Gist has no engine.json');
    return JSON.parse(f.content);
  }

  const cacheBust = `${gistUrl}${gistUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
  const res = await fetch(cacheBust, { headers: { 'User-Agent': 'ariotica' }, signal: AbortSignal.timeout(GIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Gist fetch failed: HTTP ${res.status}`);
  return res.json();
}

async function resolveUrl({ forceRefresh = false } = {}) {
  if (cachedChatUrl && !forceRefresh) return cachedChatUrl;

  const direct = process.env.SKRITIMAI_URL || process.env.SKRITIMAI_BASE_URL;
  if (direct) return (cachedChatUrl = buildChatUrl(direct));

  const gistId  = process.env.SKRITIMAI_GIST_ID;
  const gistUrl = process.env.SKRITIMAI_GIST_URL;
  if (!gistId && !gistUrl) throw new Error('Skritimai not configured');

  const state = await readGistState(gistId, gistUrl);
  if (state.status !== 'online') throw new Error(`Kaggle is booting (${state.status || 'offline'})`);

  const ageMs = Date.now() - Date.parse(state.updated_at || state.timestamp || '');
  if (!Number.isFinite(ageMs) || ageMs > GIST_MAX_AGE_MS) throw new Error(`Engine heartbeat stale`);

  const base = state.openai_base_url || (state.url ? `${state.url.replace(/\/+$/, '')}/v1` : '');
  if (!base) throw new Error('Gist has no url');
  return (cachedChatUrl = buildChatUrl(base));
}

async function healthCheck({ forceRefresh = false, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  if (!forceRefresh && healthCache.ok !== null && Date.now() - healthCache.checkedAt < 60000) return healthCache;

  const start = Date.now();
  try {
    const chatUrl = await resolveUrl();
    const modelsUrl = buildModelsUrl(chatUrl);

    const res = await fetch(modelsUrl, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) {
      healthCache = { ok: true, reason: null, checkedAt: Date.now(), latencyMs: Date.now() - start };
    } else {
      healthCache = { ok: false, reason: `HTTP ${res.status}`, checkedAt: Date.now(), latencyMs: Date.now() - start };
    }
  } catch (e) {
    const reason = e.name === 'TimeoutError' || e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message;
    healthCache = { ok: false, reason, checkedAt: Date.now(), latencyMs: Date.now() - start };
  }
  return healthCache;
}

async function call({ model = 'skritimai', messages, json = false, maxTokens, signal }) {
  const url = await resolveUrl();
  
  const body = {
    model,
    messages,
    max_tokens: maxTokens || 8000,
    stream: false
  };
  
  if (json) body.response_format = { type: 'json_object' };

  // FIX 3: Removed hardcoded 45s timeout. We use the signal passed from providers.js
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal: signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 503) throw new Error('Skritimai is waking up (503 Service Unavailable)');
    throw new Error(`Skritimai HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Skritimai API Error: ${JSON.stringify(data.error)}`);

  const choice = data.choices?.[0];
  let text = choice?.message?.content || '';
  if (typeof text === 'object') text = JSON.stringify(text);
  if (!text || text.length < 5) throw new Error('Skritimai returned an empty response');

  return { text, finish: choice?.finish_reason || 'stop', usage: data.usage || null };
}

module.exports = { call, healthCheck, isConfigured, reset };