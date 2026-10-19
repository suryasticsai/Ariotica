'use strict';
// LLM providers behind one OpenAI-compatible interface.
// 100% free stack: Groq, Gemini, OpenRouter, Pollinations (no credit card).

const REFERER = 'https://suryasticsai.github.io/Ariotica/';
const DEFAULT_ORDER = 'groq,gemini,openrouter,pollinations';
const FATAL_STATUS = [400, 401, 402, 403, 404, 413, 429];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envList(name, defaults) {
  const v = (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return v.length ? v : defaults;
}

function httpErr(status, text) {
  const e = new Error(`HTTP ${status}: ${String(text || '').slice(0, 200)}`);
  e.fatal = FATAL_STATUS.includes(status);
  return e;
}

async function fetchWithTimeout(url, init, ms, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
    const text = await res.text();
    return { res, text };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
    throw e;
  } finally { clearTimeout(t); }
}

async function openRouterModels() {
  let models = [];
  try {
    const { text } = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {}, 20000, 'OpenRouter model list');
    const list = JSON.parse(text).data || [];
    const free = list.filter((m) => /:free$/.test(m.id) && Number(m.context_length || 0) >= 16000);
    const pref = [/qwen.*coder/i, /deepseek/i, /llama-3\.3/i, /qwen/i, /gemma/i, /mistral/i];
    const rank = (id) => { const i = pref.findIndex((p) => p.test(id)); return i === -1 ? 99 : i; };
    free.sort((a, b) => rank(a.id) - rank(b.id));
    models = free.slice(0, 3).map((m) => m.id);
  } catch (e) { console.log('[OpenRouter] model list failed:', e.message); }
  models = envList('OPENROUTER_MODEL', []).concat(models);
  if (!models.length) models = ['qwen/qwen-2.5-coder-32b-instruct:free', 'deepseek/deepseek-r1:free'];
  console.log('[OpenRouter] trying models:', models.join(', '));
  return models;
}

const PROVIDERS = {
  groq: {
    label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY',
    models: async () => envList('GROQ_MODEL', ['qwen/qwen3-32b', 'llama-3.1-8b-instant']),
    timeout: 90000, maxTokens: 8000,
  },
  gemini: {
    label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: 'GEMINI_API_KEY',
    models: async () => envList('GEMINI_MODEL', ['gemini-2.5-flash', 'gemini-2.0-flash']),
    timeout: 90000, maxTokens: 8000,
  },
  openrouter: {
    label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'OPENROUTER_API_KEY',
    models: openRouterModels, timeout: 120000, maxTokens: 12000,
    headers: { 'HTTP-Referer': REFERER, 'X-Title': 'Ariotica' },
  },
  pollinations: {
    label: 'Pollinations', url: 'https://text.pollinations.ai/openai', key: null,
    models: async () => ['openai'], timeout: 150000, maxTokens: 0, jsonMode: true,
    headers: { Referer: REFERER },
  },
};

async function callProvider(id, messages, opts) {
  const cfg = PROVIDERS[id];
  const token = cfg.key ? process.env[cfg.key] : '';
  if (cfg.key && !token) throw new Error(`${cfg.key} not set`);
  
  const models = await cfg.models();
  let lastErr = new Error('no models configured');
  let allFatal = true;
  for (const model of models) {
    try {
      const body = { model, messages };
      const maxTokens = opts.maxTokens || cfg.maxTokens;
      if (maxTokens) body.max_tokens = maxTokens;
      if (opts.json && cfg.jsonMode) body.response_format = { type: 'json_object' };
      const headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
      if (token) headers.Authorization = `Bearer ${token}`;
      const { res, text } = await fetchWithTimeout(cfg.url,
        { method: 'POST', headers, body: JSON.stringify(body) }, cfg.timeout, `${cfg.label}/${model}`);
      if (!res.ok) throw httpErr(res.status, text);
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('provider returned non-JSON'); }
      const choice = data.choices && data.choices[0];
      const out = (choice && choice.message && choice.message.content) || data.text || '';
      if (!out || out.length < 20) throw new Error('empty or very short response');
      console.log(`[${cfg.label}] ok with ${model} (${out.length} chars)`);
      return { text: out, model, finish: choice && choice.finish_reason };
    } catch (e) {
      lastErr = e;
      if (!e.fatal) allFatal = false;
      console.log(`[${cfg.label}] ${model} failed: ${e.message}`);
    }
  }
  lastErr.fatal = allFatal;
  throw lastErr;
}

async function askAI(messages, opts) {
  opts = opts || {};
  const emit = opts.onEvent || (async () => {});
  const order = (process.env.PROVIDER_ORDER || DEFAULT_ORDER).split(',')
    .map((x) => x.trim().toLowerCase()).filter((x) => PROVIDERS[x]);
  const errors = [];
  for (const id of order) {
    const cfg = PROVIDERS[id];
    if (cfg.key && !process.env[cfg.key]) { console.log(`[${cfg.label}] skipped: ${cfg.key} not set`); continue; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = Date.now();
      const name = `${cfg.label} · attempt ${attempt}`;
      await emit({ type: 'start', name });
      try {
        const r = await callProvider(id, messages, opts);
        await emit({ type: 'ok', name, sec: Math.round((Date.now() - t0) / 1000), chars: r.text.length, model: r.model });
        return { text: r.text, provider: cfg.label, model: r.model, finish: r.finish };
      } catch (e) {
        const msg = String(e.message || e).slice(0, 220);
        errors.push(`${cfg.label} #${attempt}: ${msg}`);
        await emit({ type: 'fail', name, sec: Math.round((Date.now() - t0) / 1000), error: msg });
        if (e.fatal) break;
        if (attempt < 2) await sleep(2000);
      }
    }
  }
  throw new Error('All providers failed:\n' + (errors.join('\n') || 'no provider configured'));
}

module.exports = { askAI, PROVIDERS, httpErr, DEFAULT_ORDER };