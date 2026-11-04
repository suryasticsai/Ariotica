'use strict';

const HEALTH_TIMEOUT_MS = 3000;   

let cachedChatUrl = null;
let healthCache = { ok: null, reason: null, checkedAt: 0 };

function reset() {
  cachedChatUrl = null;
  healthCache = { ok: null, reason: null, checkedAt: 0 };
}

function isConfigured() {
  return !!(process.env.SKRITIMAI_BASE_URL || process.env.SKRITIMAI_URL);
}

function getApiKey() {
  return process.env.SKRITIMAI_API_KEY || 'sk-no-key';
}

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getApiKey()}`
  };
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

async function resolveUrl({ forceRefresh = false } = {}) {
  if (cachedChatUrl && !forceRefresh) return cachedChatUrl;
  
  const base = process.env.SKRITIMAI_BASE_URL || process.env.SKRITIMAI_URL;
  if (!base) throw new Error('SKRITIMAI_BASE_URL not set');
  
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
    } else if (res.status === 503) {
      healthCache = { ok: false, reason: 'Kaggle is booting (503)', checkedAt: Date.now(), latencyMs: Date.now() - start };
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

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal: signal // Timeout handled by providers.js
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