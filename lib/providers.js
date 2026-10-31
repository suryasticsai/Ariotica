'use strict';
// LLM providers behind one OpenAI-compatible interface.
const { computeCost } = require('./pricing');

const REFERER = 'https://suryasticsai.github.io/Ariotica/';
// Skritimai is first, but will be skipped for large prompts
const DEFAULT_ORDER = 'skritimai,groq,openrouter';

const ACCOUNT_STATUS = [401, 402, 403];
const MODEL_GONE_RE = /decommission|deprecated|does not exist|do not have access|no longer (?:available|supported)|model[^"]{0,40}not found|not supported/i;
const TOO_LARGE_RE = /request too large|too large for model|context length|maximum context|reduce the length/i;
const DAILY_LIMIT_RE = /per day|\bTPD\b|\bRPD\b|daily/i;
const MAX_429_WAIT_S = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deadProviders = new Map(); 
const deadModels = new Map();    
const tooLarge = new Map();      

function envList(name, defaults) {
  const v = (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return v.length ? v : defaults;
}

function softErr(message, transient) {
  const e = new Error(message);
  e.transient = !!transient;
  e.fatal = !transient;
  return e;
}

function httpErr(status, text, headers) {
  const body = String(text || '');
  const e = new Error(`HTTP ${status}: ${body.slice(0, 200)}`);
  e.status = status;
  e.account = ACCOUNT_STATUS.includes(status);
  e.modelGone = (status === 404 || status === 400) && MODEL_GONE_RE.test(body);
  e.tooLarge = status === 413 || (status === 400 && TOO_LARGE_RE.test(body));
  e.dailyLimit = status === 429 && DAILY_LIMIT_RE.test(body);
  e.transient = (status === 429 && !e.dailyLimit) || status >= 500;
  e.fatal = !e.transient;
  const ra = headers && typeof headers.get === 'function' ? parseInt(headers.get('retry-after') || '', 10) : NaN;
  e.retryAfter = Number.isFinite(ra) ? ra : null;
  return e;
}

function cancelledError(label) {
  const e = new Error(`${label || 'request'} cancelled`);
  e.cancelled = true;
  return e;
}

async function fetchWithTimeout(url, init, ms, label, signal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
    const text = await res.text();
    return { res, text };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (signal && signal.aborted) throw cancelledError(label);
      throw softErr(`${label} timed out after ${Math.round(ms / 1000)}s`, true);
    }
    const ne = softErr(`${label} network error: ${String((e && e.message) || e).slice(0, 120)}`, true);
    throw ne;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
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
  const envModels = envList('OPENROUTER_MODEL', []);
  models = envModels.concat(models.filter((m) => !envModels.includes(m)));
  if (!models.length) models = ['qwen/qwen-2.5-coder-32b-instruct'];
  console.log('[OpenRouter] trying models:', models.join(', '));
  return models;
}

const PROVIDERS = {
  skritimai: {
    label: 'Skritimai',
    url: process.env.SKRITIMAI_BASE_URL || 'https://skritimai.varakala-saisurya.workers.dev/v1/chat/completions',
    key: null, 
    models: async () => ['qwen2.5:7b'], 
    timeout: Number(process.env.SKRITIMAI_TIMEOUT_MS) || 180000,
    maxTokens: 8000,
    jsonMode: true,
    // SMART ROUTING: Only use Skritimai for prompts under 12,000 chars to avoid Cloudflare timeout
    maxPromptChars: 12000, 
  },
  groq: {
    label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY',
    // Updated to Groq's current active models
    models: async () => envList('GROQ_MODEL', ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']),
    timeout: 90000,
    maxTokens: Number(process.env.GROQ_MAX_TOKENS) || 8000,
    jsonMode: true,
  },
  openrouter: {
    label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'OPENROUTER_API_KEY',
    models: openRouterModels, timeout: 120000, maxTokens: 12000,
    jsonMode: true,
    headers: { 'HTTP-Referer': REFERER, 'X-Title': 'Ariotica' },
  },
  pollinations: {
    label: 'Pollinations', url: 'https://text.pollinations.ai/openai', key: null,
    models: async () => ['openai'], timeout: 150000, maxTokens: 0, jsonMode: true,
    headers: { Referer: REFERER },
  },
  huggingface: {
    label: 'HuggingFace', url: 'https://router.huggingface.co/v1/chat/completions', key: 'HF_TOKEN',
    models: async () => envList('HF_MODEL', ['Qwen/Qwen2.5-Coder-32B-Instruct']),
    timeout: 120000, maxTokens: 12000,
    jsonMode: true,
  },
};

function parseCompletion(cfg, model, text) {
  let data;
  try { data = JSON.parse(text); } catch { throw softErr('provider returned non-JSON', true); }

  if (data && data.error) {
    const code = Number(data.error.code) || 502;
    throw httpErr(code, JSON.stringify(data.error));
  }

  const choice = data.choices && data.choices[0];
  const msg = (choice && choice.message) || {};
  let out = '';
  if (typeof msg.content === 'string') out = msg.content;
  else if (Array.isArray(msg.content)) out = msg.content.map((p) => (p && p.text) || '').join('');
  else out = data.text || '';

  if (!out || out.length < 20) throw softErr('empty or very short response', true);
  if (choice && choice.finish_reason === 'length') throw softErr('Response cut off (length limit reached).', false);

  const usage = data.usage || null;
  const { cost, tin, tout } = computeCost(model, usage);
  console.log(`[${cfg.label}] ok with ${model} (${out.length} chars, finish=${choice && choice.finish_reason}, tokens=${tin}/${tout}, $${cost.toFixed(6)})`);
  return { text: out, model, finish: choice && choice.finish_reason, usage, cost, tin, tout };
}

async function requestModel(cfg, model, messages, opts, headers) {
  const body = { model, messages };
  const maxTokens = opts.maxTokens || cfg.maxTokens;
  if (maxTokens) body.max_tokens = maxTokens;
  if (opts.json && cfg.jsonMode) body.response_format = { type: 'json_object' };
  if (cfg.extraBody) Object.assign(body, cfg.extraBody(model));

  const { res, text } = await fetchWithTimeout(cfg.url,
    { method: 'POST', headers, body: JSON.stringify(body) }, cfg.timeout, `${cfg.label}/${model}`, opts.signal);
  if (!res.ok) throw httpErr(res.status, text, res.headers);
  return parseCompletion(cfg, model, text);
}

async function callProvider(id, messages, opts) {
  const cfg = PROVIDERS[id];
  const signal = opts.signal;
  const promptChars = opts.promptChars || 0;
  const token = cfg.key ? process.env[cfg.key] : '';
  const models = await cfg.models();

  const headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
  if (token) headers.Authorization = `Bearer ${token}`;

  let lastErr = softErr(`${cfg.label}: no usable models`, false);
  let allFatal = true;

  for (const model of models) {
    if (signal && signal.aborted) throw cancelledError(cfg.label);
    const key = `${id}/${model}`;
    if (deadModels.has(key)) { console.log(`[${cfg.label}] skip ${model}: ${deadModels.get(key)}`); continue; }
    if (tooLarge.has(key) && promptChars >= tooLarge.get(key)) {
      console.log(`[${cfg.label}] skip ${model}: prompt too large`);
      continue;
    }

    try {
      for (let tryNo = 1; ; tryNo++) {
        try { return await requestModel(cfg, model, messages, Object.assign({}, opts, { signal }), headers); }
        catch (e) {
          if (e.status === 429 && !e.dailyLimit && tryNo === 1) {
            const waitS = Math.max(e.retryAfter || 4, 1);
            if (waitS > MAX_429_WAIT_S) throw e;
            console.log(`[${cfg.label}] 429 on ${model}, retrying in ${waitS}s...`);
            await sleep(waitS * 1000);
            if (signal && signal.aborted) throw cancelledError(cfg.label);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e.cancelled) throw e;
      lastErr = e;
      if (!e.fatal) allFatal = false;
      console.log(`[${cfg.label}] ${model} failed: ${e.message}`);

      if (e.account) { deadProviders.set(id, `HTTP ${e.status}`); break; }
      if (e.modelGone) deadModels.set(key, `HTTP ${e.status} unavailable`);
      else if (e.dailyLimit) deadModels.set(key, 'daily limit reached');
      if (e.tooLarge && promptChars) tooLarge.set(key, Math.min(tooLarge.get(key) || Infinity, promptChars));
    }
  }
  lastErr.fatal = allFatal;
  throw lastErr;
}

async function runOne(id, signal, ctx, racing) {
  const cfg = PROVIDERS[id];
  const name = `${cfg.label}${racing ? ' · racing' : ''}`;
  const t0 = Date.now();
  const sec = () => Math.round((Date.now() - t0) / 1000);
  await ctx.emit({ type: 'start', name });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await callProvider(id, ctx.messages, Object.assign({}, ctx.opts, { signal }));
      if (signal.aborted) throw cancelledError(cfg.label);
      let g;
      try { g = await ctx.grade(r.text); }
      catch (e) { g = { ok: false, score: 0, reason: 'grading crashed: ' + String(e.message || e).slice(0, 120) }; }
      const cand = { text: r.text, provider: cfg.label, model: r.model, finish: r.finish, grade: g, sec: sec() };
      ctx.candidates.push(cand);
      ctx.report.push({
        provider: cfg.label, model: r.model, sec: cand.sec, ok: !!g.ok, score: g.score, reason: g.reason || '',
        cost: r.cost || 0, tokensIn: r.tin || 0, tokensOut: r.tout || 0,
      });
      await ctx.emit({ type: g.ok ? 'ok' : 'fail', name, sec: cand.sec, chars: r.text.length, model: r.model, error: g.ok ? undefined : (g.reason || 'failed checks') });
      return cand;
    } catch (e) {
      if (e.cancelled || signal.aborted) {
        ctx.report.push({ provider: cfg.label, sec: sec(), ok: false, reason: 'lost the race' });
        await ctx.emit({ type: 'cancel', name, sec: sec() });
        throw cancelledError(cfg.label);
      }
      const msg = String(e.message || e).slice(0, 220);
      ctx.errors.push(`${cfg.label} #${attempt}: ${msg}`);
      if (e.fatal || attempt === 2 || deadProviders.has(id)) {
        ctx.report.push({ provider: cfg.label, sec: sec(), ok: false, reason: msg });
        await ctx.emit({ type: 'fail', name, sec: sec(), error: msg });
        throw e;
      }
      await sleep(2000);
    }
  }
}

function race(ids, ctx) {
  return new Promise((resolve) => {
    const ctrls = ids.map(() => new AbortController());
    let pending = ids.length;
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      ctrls.forEach((c) => c.abort());
      resolve(val);
    };
    ids.forEach((id, i) => {
      runOne(id, ctrls[i].signal, ctx, ids.length > 1)
        .then((cand) => { if (cand.grade.ok) finish(cand); })
        .catch(() => { })
        .finally(() => { pending -= 1; if (pending === 0) finish(null); });
    });
  });
}

function parseOrder() {
  return (process.env.PROVIDER_ORDER || DEFAULT_ORDER).split(',')
    .map((x) => x.trim().toLowerCase()).filter((x) => PROVIDERS[x]);
}

async function askAI(messages, opts) {
  opts = opts || {};
  const promptChars = messages.reduce((n, m) => n + String((m && m.content) || '').length, 0);
  const ctx = {
    messages, opts: Object.assign({}, opts, { promptChars }), report: [], errors: [], candidates: [],
    emit: opts.onEvent || (async () => {}),
    grade: opts.grade || (async (t) => ({ ok: String(t).length >= 20, score: 1 })),
  };
  const deadline = Date.now() + (Number(process.env.ASK_DEADLINE_MS) || 240000);

  const available = [];
  const tooBig = [];
  for (const id of parseOrder()) {
    const cfg = PROVIDERS[id];
    if (cfg.key && !process.env[cfg.key]) { console.log(`[${cfg.label}] skipped: ${cfg.key} not set`); continue; }
    if (deadProviders.has(id)) { console.log(`[${cfg.label}] skipped: disabled this run`); continue; }
    
    // SMART ROUTING LOGIC:
    if (cfg.maxPromptChars && promptChars > cfg.maxPromptChars) {
      console.log(`[${cfg.label}] skipped: prompt too large (${promptChars} > ${cfg.maxPromptChars})`);
      tooBig.push(id); continue;
    }
    
    available.push(id);
  }
  if (!available.length && tooBig.length) available.push(...tooBig);
  if (!available.length) throw new Error('All providers failed:\nno provider is configured or available');

  const size = Math.min(Math.max(parseInt(process.env.RACE_SIZE || '1', 10) || 1, 1), 5);
  const racers = available.slice(0, size);
  console.log(`[race] ${racers.join(' vs ')}${available.length > size ? `  (fallback: ${available.slice(size).join(', ')})` : ''} · prompt ${promptChars} chars`);

  let winner = await race(racers, ctx);
  for (const id of available.slice(size)) {
    if (winner) break;
    if (deadProviders.has(id)) continue;
    if (Date.now() > deadline && ctx.candidates.length) { console.log('[race] deadline reached'); break; }
    try {
      const cand = await runOne(id, new AbortController().signal, ctx, false);
      if (cand.grade.ok) winner = cand;
    } catch { }
  }

  if (winner) console.log(`🏆 [race] winner: ${winner.provider} (${winner.model}) in ${winner.sec}s`);
  const best = winner || ctx.candidates.slice().sort((a, b) => (b.grade.score || 0) - (a.grade.score || 0))[0];
  if (!best) throw new Error('All providers failed:\n' + (ctx.errors.join('\n') || 'no response'));
  if (!winner) console.log(`[race] nobody passed; returning best (${best.provider})`);
  return Object.assign({}, best, { race: ctx.report });
}

module.exports = {
  askAI, PROVIDERS, httpErr, DEFAULT_ORDER,
  _state: { deadProviders, deadModels, tooLarge },
};