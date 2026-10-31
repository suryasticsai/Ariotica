'use strict';
// LLM provider router for Ariotica.
//
// Rules this file enforces:
//  1. Fall back to the next provider ONLY when a provider failed to deliver a response
//     (rate limit, outage, timeout, truncated/empty/non-JSON reply). A response that arrived
//     but failed grading is returned to generate.js so its repair loop can fix it.
//  2. One run budget (RUN_BUDGET_MS) caps the whole job. Every in-flight request is aborted
//     when it runs out, and askAI throws BudgetError so generate.js can fail cleanly.
//  3. Each provider gets its own time slice, so a slow primary can never starve the fallbacks.
//  4. A health table remembers what failed, so later calls (repair loop) skip dead models at once.
//  5. Skritimai (self-hosted, slow) is only used for task kinds listed in SKRITIMAI_KINDS
//     (default: "edit"), streams its reply, and finds the live tunnel URL through a Gist.
const { computeCost } = require('./pricing');

const REFERER = 'https://suryasticsai.github.io/Ariotica/';
const DEFAULT_ORDER = 'skritimai,groq,openrouter';

const MODEL_GONE_RE = /decommission|deprecated|does not exist|do not have access|no longer (?:available|supported)|model[^"]{0,40}not found|not supported/i;
const DAILY_LIMIT_RE = /per day|\bTPD\b|\bRPD\b|daily/i;
const NO_UPSTREAM_RE = /no upstreams?|no endpoints?/i;
const MAX_INLINE_429_WAIT_S = 20;

// ---------------------------------------------------------------- run state
let RUN_START = Date.now();
const envNum = (name, d) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : d; };
const runBudgetMs = () => envNum('RUN_BUDGET_MS', 9 * 60 * 1000);
const runDeadline = () => RUN_START + runBudgetMs();
const elapsedS = () => Math.round((Date.now() - RUN_START) / 1000);

const health = new Map();        // "provider/model" -> { dead, strikes, cooldownUntil }
const providerDead = new Map();  // provider id -> reason
const totals = { calls: 0, cost: 0, tokensIn: 0, tokensOut: 0 };
let skritimaiBase = null;        // resolved once per run

function envList(name, defaults) {
  const v = (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return v.length ? v : defaults;
}

class BudgetError extends Error {
  constructor(message) { super(message); this.name = 'BudgetError'; this.budget = true; }
}

// ------------------------------------------------------------------- errors
function softError(message, kind) { const e = new Error(message); e.kind = kind; return e; }
function cancelled(label) { const e = new Error(`${label} cancelled`); e.kind = 'cancel'; e.cancelled = true; return e; }
function httpError(status, body, headers) {
  const text = String(body || '');
  const e = new Error(`HTTP ${status}: ${text.slice(0, 200)}`);
  e.kind = 'http';
  e.status = status;
  e.body = text.slice(0, 500);
  const ra = headers && typeof headers.get === 'function' ? Number(headers.get('retry-after')) : NaN;
  if (Number.isFinite(ra) && ra >= 0) e.retryAfter = ra;
  return e;
}

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(cancelled('wait'));
    let onAbort;
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    onAbort = () => { clearTimeout(t); reject(cancelled('wait')); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ------------------------------------------------------------ health table
function getHealth(key) {
  if (!health.has(key)) health.set(key, { dead: null, strikes: 0, cooldownUntil: 0 });
  return health.get(key);
}
function markOk(key) { const h = getHealth(key); h.strikes = 0; h.cooldownUntil = 0; }
function markStrike(key, why) { const h = getHealth(key); h.strikes += 1; if (h.strikes >= 2) h.dead = why; }
function markDead(key, why) { getHealth(key).dead = why; }
function markCooldown(key, seconds) { getHealth(key).cooldownUntil = Date.now() + Math.min(seconds, 3600) * 1000; }

// What should happen to a model/provider after this error?
function classify(id, e) {
  if (e.cancelled || e.kind === 'cancel') return { type: 'cancel' };
  if (e.kind === 'offline' || e.kind === 'discovery') return { type: 'provider-dead' };
  if (e.kind === 'timeout' || e.kind === 'format') return { type: 'strike' };
  if (e.kind === 'network') return id === 'skritimai' ? { type: 'provider-dead' } : { type: 'strike' };
  const s = e.status;
  const text = e.body || e.message || '';
  if (s === 429) {
    if (DAILY_LIMIT_RE.test(text)) return { type: 'dead' };
    return { type: 'cooldown', seconds: e.retryAfter != null ? e.retryAfter : 60 };
  }
  if (s === 401 || s === 402 || s === 403) return { type: 'provider-dead' };
  if ((s === 400 || s === 404) && MODEL_GONE_RE.test(text)) return { type: 'dead' };
  if (id === 'skritimai' && (s === 502 || s === 504 || s >= 520)) return { type: 'provider-dead' };
  if (s === 503 && NO_UPSTREAM_RE.test(text)) return { type: 'dead' };
  return { type: 'strike' };
}

// ----------------------------------------------------------------- fetching
function classifyFetchFailure(e, label, signal, timedOut, timeoutMs) {
  if (timedOut) return softError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`, 'timeout');
  if (signal && signal.aborted) return cancelled(label);
  if (e && e.kind) return e;
  return softError(`${label} network error: ${String((e && e.message) || e).slice(0, 120)}`, 'network');
}

async function fetchText(url, init, timeoutMs, label, signal) {
  if (signal && signal.aborted) throw cancelled(label);
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
    const text = await res.text();
    return { res, text };
  } catch (e) {
    throw classifyFetchFailure(e, label, signal, timedOut, timeoutMs);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Streaming request (OpenAI-style server-sent events). Keeps Cloudflare tunnels alive and
// lets us time out on silence instead of on total duration.
async function fetchStream(url, init, signal, label, firstMs, idleMs) {
  if (signal && signal.aborted) throw cancelled(label);
  const ctrl = new AbortController();
  let timedOut = false;
  let limit = firstMs;
  let timer;
  const arm = (ms) => { limit = ms; clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms); };
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  arm(firstMs);

  try {
    const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
    if (!res.ok) throw httpError(res.status, await res.text(), res.headers);

    let out = '';
    let finish = null;
    let usage = null;
    let buf = '';
    const handleLine = (raw) => {
      const line = raw.trim();
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let ev;
      try { ev = JSON.parse(payload); } catch { return; }   // a complete line that is not JSON: ignore
      if (ev && ev.error) {
        const e = new Error('stream error: ' + String(ev.error.message || JSON.stringify(ev.error)).slice(0, 200));
        e.kind = 'http';
        e.status = Number(ev.error.code) || 502;
        throw e;
      }
      const choice = ev && ev.choices && ev.choices[0];
      if (choice) {
        const piece = choice.delta && choice.delta.content;
        if (typeof piece === 'string') out += piece;
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (ev && ev.usage) usage = ev.usage;
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(idleMs);                                  // the first bytes arrived: switch to the idle limit
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {       // only parse complete lines; keep the tail
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        handleLine(line);
      }
    }
    buf += decoder.decode();
    if (buf.trim()) handleLine(buf);

    return { text: out, finish: finish || 'stop', usage };
  } catch (e) {
    throw classifyFetchFailure(e, label, signal, timedOut, limit);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// ------------------------------------------------------------- Skritimai URL
async function readGistState(gistId, gistUrl) {
  if (gistId) {
    const base = { 'User-Agent': 'ariotica', Accept: 'application/vnd.github+json' };
    const token = process.env.SKRITIMAI_GIST_TOKEN || process.env.GITHUB_TOKEN;
    const url = `https://api.github.com/gists/${encodeURIComponent(gistId)}`;
    let r = await fetchText(url, { headers: token ? Object.assign({ Authorization: `Bearer ${token}` }, base) : base }, 8000, 'Skritimai gist', null);
    if (!r.res.ok && token && (r.res.status === 401 || r.res.status === 403)) {
      r = await fetchText(url, { headers: base }, 8000, 'Skritimai gist', null);
    }
    if (!r.res.ok) throw httpError(r.res.status, r.text, r.res.headers);
    const files = JSON.parse(r.text).files || {};
    const f = files['engine.json'] || Object.values(files)[0];
    if (!f || typeof f.content !== 'string') throw softError('gist has no engine.json', 'discovery');
    return JSON.parse(f.content);
  }
  const url = gistUrl + (gistUrl.includes('?') ? '&' : '?') + 't=' + Date.now();   // defeat raw-URL caching
  const r = await fetchText(url, { headers: { 'User-Agent': 'ariotica' } }, 8000, 'Skritimai gist', null);
  if (!r.res.ok) throw httpError(r.res.status, r.text, r.res.headers);
  return JSON.parse(r.text);
}

function chatCompletionsUrl(base) {
  const b = String(base).replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

// Resolve the live endpoint once per run. Throws kind "offline"/"discovery" when the engine is not usable.
async function resolveSkritimaiUrl() {
  if (skritimaiBase) return skritimaiBase;
  const gistId = process.env.SKRITIMAI_GIST_ID;
  const gistUrl = process.env.SKRITIMAI_GIST_URL;
  const fallback = process.env.SKRITIMAI_BASE_URL;

  if (!gistId && !gistUrl) {
    if (!fallback) throw softError('SKRITIMAI_BASE_URL / SKRITIMAI_GIST_ID not set', 'discovery');
    return (skritimaiBase = chatCompletionsUrl(fallback));
  }

  let state;
  try {
    state = await readGistState(gistId, gistUrl);
  } catch (e) {
    if (fallback) { console.log(`[Skritimai] gist lookup failed (${e.message}); using SKRITIMAI_BASE_URL`); return (skritimaiBase = chatCompletionsUrl(fallback)); }
    throw softError(`Skritimai discovery failed: ${String(e.message || e).slice(0, 120)}`, 'discovery');
  }

  if (state.status !== 'online') throw softError(`Skritimai engine is ${state.status || 'offline'} (per gist)`, 'offline');
  const age = Date.now() - Date.parse(state.updated_at || state.timestamp || '');
  const maxAge = envNum('SKRITIMAI_MAX_AGE_MS', 15 * 60 * 1000);
  if (!Number.isFinite(age) || age > maxAge) {
    throw softError(`Skritimai gist is stale (${Number.isFinite(age) ? Math.round(age / 60000) + ' min' : 'no timestamp'} old)`, 'offline');
  }
  const base = state.openai_base_url || (state.url ? String(state.url).replace(/\/+$/, '') + '/v1' : '');
  if (!base) throw softError('gist has no url', 'discovery');
  console.log(`[Skritimai] engine online at ${base} (heartbeat ${Math.round(age / 1000)}s ago)`);
  return (skritimaiBase = chatCompletionsUrl(base));
}

// ---------------------------------------------------------------- providers
const PROVIDERS = {
  skritimai: {
    label: 'Skritimai',
    key: 'SKRITIMAI_API_KEY',
    stream: true,
    jsonMode: true,
    models: async () => envList('SKRITIMAI_MODEL', ['skritimai']),
    sliceMs: () => envNum('SKRITIMAI_TIMEOUT_MS', 200000),
    maxTokens: () => envNum('SKRITIMAI_MAX_TOKENS', 8000),
    firstTokenMs: () => envNum('SKRITIMAI_FIRST_TOKEN_MS', 120000),
    idleMs: () => envNum('SKRITIMAI_IDLE_MS', 30000),
  },
  groq: {
    label: 'Groq',
    key: 'GROQ_API_KEY',
    jsonMode: true,
    url: () => process.env.GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions',
    models: async () => envList('GROQ_MODEL', ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']),
    sliceMs: () => envNum('GROQ_SLICE_MS', 100000),
    timeoutMs: () => envNum('GROQ_TIMEOUT_MS', 45000),
    maxTokens: () => envNum('GROQ_MAX_TOKENS', 8000),
    extraBody: (model) => (process.env.GROQ_REASONING_EFFORT && /gpt-oss/i.test(model)
      ? { reasoning_effort: process.env.GROQ_REASONING_EFFORT } : {}),
  },
  openrouter: {
    label: 'OpenRouter',
    key: 'OPENROUTER_API_KEY',
    jsonMode: true,
    url: () => process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions',
    models: async () => envList('OPENROUTER_MODEL', ['xingchen-agi/xing4.0-29b-a4b:free']),
    sliceMs: () => envNum('OPENROUTER_SLICE_MS', 45000),
    timeoutMs: () => envNum('OPENROUTER_TIMEOUT_MS', 30000),
    maxTokens: () => envNum('OPENROUTER_MAX_TOKENS', 12000),
    headers: { 'HTTP-Referer': REFERER, 'X-Title': 'Ariotica' },
  },
  huggingface: {
    label: 'HuggingFace',
    key: 'HF_TOKEN',
    jsonMode: true,
    url: () => process.env.HF_URL || 'https://router.huggingface.co/v1/chat/completions',
    models: async () => envList('HF_MODEL', ['Qwen/Qwen2.5-Coder-32B-Instruct']),
    sliceMs: () => envNum('HF_SLICE_MS', 60000),
    timeoutMs: () => envNum('HF_TIMEOUT_MS', 55000),
    maxTokens: () => envNum('HF_MAX_TOKENS', 12000),
  },
};

function parseCompletion(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw softError('provider returned non-JSON', 'format'); }

  if (data && data.error) {                       // some providers report errors inside a 200 body
    const code = Number(data.error.code);
    const e = new Error('HTTP ' + (Number.isFinite(code) ? code : 502) + ': ' + JSON.stringify(data.error).slice(0, 200));
    e.kind = 'http';
    e.status = Number.isFinite(code) && code >= 400 ? code : 502;
    e.body = JSON.stringify(data.error).slice(0, 500);
    throw e;
  }

  const choice = data.choices && data.choices[0];
  const msg = (choice && choice.message) || {};
  let out = '';
  if (typeof msg.content === 'string') out = msg.content;
  else if (Array.isArray(msg.content)) out = msg.content.map((p) => (p && p.text) || '').join('');
  else out = data.text || '';

  if (!out || out.length < 20) throw softError('empty or very short response', 'format');
  if (choice && choice.finish_reason === 'length') throw softError('Response cut off (length limit reached)', 'format');
  return { text: out, finish: choice && choice.finish_reason, usage: data.usage || null };
}

// Try each model of one provider in order. Returns the first reply that arrives.
async function callProvider(id, messages, opts) {
  const cfg = PROVIDERS[id];
  const signal = opts.signal;
  if (providerDead.has(id)) throw softError(`${cfg.label} is disabled for this run (${providerDead.get(id)})`, 'dead');

  const models = await cfg.models();
  let lastErr = softError(`${cfg.label}: no usable models (all dead or cooling down)`, 'none');

  for (const model of models) {
    const key = `${id}/${model}`;
    const h = getHealth(key);
    if (h.dead) { console.log(`[${cfg.label}] skip ${model}: ${h.dead}`); continue; }

    const coolS = (h.cooldownUntil - Date.now()) / 1000;
    if (coolS > 0) {
      if (coolS > MAX_INLINE_429_WAIT_S || Date.now() + coolS * 1000 >= runDeadline()) {
        console.log(`[${cfg.label}] skip ${model}: cooling down for ${Math.round(coolS)}s`);
        continue;
      }
      console.log(`[${cfg.label}] ${model} cooling down, waiting ${Math.ceil(coolS)}s`);
      await abortableSleep(coolS * 1000, signal);
    }

    for (let tryNo = 1; tryNo <= 2; tryNo++) {
      try {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
        const token = cfg.key ? process.env[cfg.key] : '';
        if (token) headers.Authorization = `Bearer ${token}`;

        const body = { model, messages };
        const maxTokens = opts.maxTokens || cfg.maxTokens();
        if (maxTokens) body.max_tokens = maxTokens;
        if (opts.json && cfg.jsonMode) body.response_format = { type: 'json_object' };
        if (cfg.extraBody) Object.assign(body, cfg.extraBody(model));

        let parsed;
        const label = `${cfg.label}/${model}`;
        if (cfg.stream) {
          const url = await resolveSkritimaiUrl();
          body.stream = true;
          body.stream_options = { include_usage: true };
          parsed = await fetchStream(url, { method: 'POST', headers, body: JSON.stringify(body) }, signal, label, cfg.firstTokenMs(), cfg.idleMs());
          if (parsed.finish === 'length') throw softError('Response cut off (length limit reached)', 'format');
          if (!parsed.text || parsed.text.length < 20) throw softError('empty or very short response', 'format');
        } else {
          const { res, text } = await fetchText(cfg.url(), { method: 'POST', headers, body: JSON.stringify(body) }, cfg.timeoutMs(), label, signal);
          if (!res.ok) throw httpError(res.status, text, res.headers);
          parsed = parseCompletion(text);
        }

        const { cost, tin, tout } = computeCost(model, parsed.usage);
        markOk(key);
        return { text: parsed.text, model, finish: parsed.finish, cost, tin, tout };
      } catch (err) {
        let e = err;
        // Our own slice timer fired: that is a timeout, not a cancellation.
        if ((e.cancelled || e.kind === 'cancel') && opts.sliceExpired && opts.sliceExpired()) {
          e = softError(`${cfg.label}/${model} exceeded its ${Math.round(cfg.sliceMs() / 1000)}s time slice`, 'timeout');
        }
        lastErr = e;
        const action = classify(id, e);
        if (action.type !== 'cancel') console.log(`[${cfg.label}] ${model} failed: ${String(e.message || e).slice(0, 220)}`);

        if (action.type === 'cancel') throw e;
        if (action.type === 'cooldown') {
          const wait = action.seconds;
          if (wait <= MAX_INLINE_429_WAIT_S && tryNo === 1 && Date.now() + wait * 1000 < runDeadline()) {
            console.log(`[${cfg.label}] ${model} rate limited; waiting ${wait}s then retrying once`);
            await abortableSleep(wait * 1000, signal);
            continue;
          }
          markCooldown(key, wait);
        } else if (action.type === 'provider-dead') {
          providerDead.set(id, String(e.message || e).slice(0, 100));
          throw e;
        } else if (action.type === 'dead') {
          markDead(key, String(e.message || e).slice(0, 100));
        } else {
          markStrike(key, String(e.message || e).slice(0, 100));
        }
        break;   // next model
      }
    }
  }
  throw lastErr;
}

// One provider, one graded candidate. Throws only if no response arrived.
async function runOne(id, ctx, extraSignals, racing) {
  const cfg = PROVIDERS[id];
  const name = `${cfg.label}${racing ? ' · racing' : ''}`;
  const t0 = Date.now();
  await ctx.emit({ type: 'start', name });

  const ctrl = new AbortController();
  let sliceExpired = false;
  const sliceMs = Math.max(1000, Math.min(cfg.sliceMs(), ctx.callDeadline - Date.now()));
  const sliceTimer = setTimeout(() => { sliceExpired = true; ctrl.abort(); }, sliceMs);
  const abort = () => ctrl.abort();
  const signals = extraSignals.filter(Boolean);
  for (const s of signals) { if (s.aborted) ctrl.abort(); else s.addEventListener('abort', abort, { once: true }); }

  let r;
  try {
    r = await callProvider(id, ctx.messages, Object.assign({}, ctx.opts, { signal: ctrl.signal, sliceExpired: () => sliceExpired }));
  } catch (e) {
    const sec = Math.round((Date.now() - t0) / 1000);
    if (e.cancelled || e.kind === 'cancel') {
      ctx.report.push({ provider: cfg.label, sec, ok: false, reason: 'lost the race' });
      await ctx.emit({ type: 'cancel', name, sec });
    } else {
      const msg = String(e.message || e).slice(0, 220);
      ctx.errors.push(`${cfg.label}: ${msg}`);
      ctx.report.push({ provider: cfg.label, sec, ok: false, reason: msg });
      await ctx.emit({ type: 'fail', name, sec, error: msg });
    }
    throw e;
  } finally {
    clearTimeout(sliceTimer);
    for (const s of signals) s.removeEventListener('abort', abort);
  }

  // The reply is in hand: grading is never aborted by the slice or the call timer.
  let g;
  try { g = await ctx.grade(r.text); }
  catch (e) { g = { ok: false, score: 0, reason: 'grading crashed: ' + String(e.message || e).slice(0, 120) }; }

  const sec = Math.round((Date.now() - t0) / 1000);
  const cand = { text: r.text, provider: cfg.label, model: r.model, finish: r.finish, grade: g, sec, tokensIn: r.tin || 0, tokensOut: r.tout || 0, cost: r.cost || 0 };
  ctx.candidates.push(cand);
  ctx.report.push({ provider: cfg.label, model: r.model, sec, ok: !!g.ok, score: g.score, reason: g.reason || '', cost: r.cost || 0, tokensIn: r.tin || 0, tokensOut: r.tout || 0 });
  totals.calls += 1; totals.cost += r.cost || 0; totals.tokensIn += r.tin || 0; totals.tokensOut += r.tout || 0;

  if (!g.ok) {
    console.log(`[${cfg.label}] ${r.model} reply rejected by grading: ${g.reason || 'failed checks'} (${r.text.length} chars)`);
    const errs = ((g.smoke && g.smoke.errors) || []).slice(0, 3);
    if (errs.length) console.log('  ' + errs.map((x) => String(x).slice(0, 160)).join('\n  '));
  }
  await ctx.emit({ type: g.ok ? 'ok' : 'fail', name, sec, chars: r.text.length, model: r.model, error: g.ok ? undefined : (g.reason || 'failed checks') });
  return cand;
}

function raceProviders(ids, ctx, callSignal) {
  return new Promise((resolve) => {
    const raceCtrl = new AbortController();
    let pending = ids.length;
    let done = false;
    const finish = () => { if (done) return; done = true; raceCtrl.abort(); resolve(); };
    ids.forEach((id) => {
      runOne(id, ctx, [callSignal, raceCtrl.signal], ids.length > 1)
        .then((cand) => { if (cand.grade && cand.grade.ok) finish(); })
        .catch(() => { })
        .finally(() => { pending -= 1; if (pending === 0) finish(); });
    });
  });
}

function eligibleProviders(opts) {
  const order = (process.env.PROVIDER_ORDER || DEFAULT_ORDER).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const kind = opts.kind || 'generate';
  const available = [];
  for (const id of order) {
    const cfg = PROVIDERS[id];
    if (!cfg) continue;
    if (cfg.key && !process.env[cfg.key]) { console.log(`[${cfg.label}] skipped: ${cfg.key} not set`); continue; }
    if (providerDead.has(id)) { console.log(`[${cfg.label}] skipped: disabled this run (${providerDead.get(id)})`); continue; }
    if (id === 'skritimai') {
      const kinds = envList('SKRITIMAI_KINDS', ['edit']);
      if (!kinds.includes(kind)) { console.log(`[Skritimai] skipped: task kind "${kind}" not in SKRITIMAI_KINDS (${kinds.join(',')})`); continue; }
    }
    available.push(id);
  }
  return available;
}

async function askAI(messages, opts) {
  opts = opts || {};
  const now = Date.now();
  if (now >= runDeadline()) throw new BudgetError(`Run budget exhausted (${Math.round(runBudgetMs() / 60000)} min). Aborting generation.`);

  const promptChars = messages.reduce((n, m) => n + String((m && m.content) || '').length, 0);
  const callDeadline = Math.min(runDeadline(), now + envNum('ASK_TIMEOUT_MS', 330000));
  const callCtrl = new AbortController();
  const callTimer = setTimeout(() => callCtrl.abort(), Math.max(1, callDeadline - now));

  const ctx = {
    messages, opts, callDeadline, report: [], errors: [], candidates: [],
    emit: opts.onEvent || (async () => { }),
    grade: opts.grade || (async (t) => ({ ok: String(t).length >= 20, score: 1 })),
  };

  try {
    const available = eligibleProviders(opts);
    if (!available.length) throw new Error('All providers failed:\nno provider is configured or available');

    const size = Math.min(Math.max(parseInt(process.env.RACE_SIZE || '1', 10) || 1, 1), 5);
    const racers = available.slice(0, size);
    console.log(`[race] ${racers.join(' vs ')}${available.length > size ? `  (fallback: ${available.slice(size).join(', ')})` : ''} · kind ${opts.kind || 'generate'} · prompt ${promptChars} chars · run ${elapsedS()}s/${Math.round(runBudgetMs() / 1000)}s`);

    await raceProviders(racers, ctx, callCtrl.signal);

    for (const id of available.slice(size)) {          // fallback only while NO reply has arrived
      if (ctx.candidates.length) break;
      if (callCtrl.signal.aborted) break;
      if (providerDead.has(id)) continue;
      try { await runOne(id, ctx, [callCtrl.signal], false); } catch { }
    }

    if (!ctx.candidates.length) {
      if (Date.now() >= runDeadline()) throw new BudgetError(`Run budget exhausted (${Math.round(runBudgetMs() / 60000)} min). Aborting generation.`);
      throw new Error('All providers failed:\n' + (ctx.errors.join('\n') || 'no response'));
    }

    const passed = ctx.candidates.find((c) => c.grade && c.grade.ok);
    const best = passed || ctx.candidates.slice().sort((a, b) => ((b.grade && b.grade.score) || 0) - ((a.grade && a.grade.score) || 0))[0];
    if (passed) console.log(`🏆 [race] winner: ${best.provider} (${best.model}) in ${best.sec}s`);
    else console.log(`[race] no reply passed grading; returning best (${best.provider}) for repair`);
    console.log(`[ai] ${opts.kind || 'generate'} → ${best.provider}/${best.model} ${best.sec}s in=${best.tokensIn} out=${best.tokensOut} $${(best.cost || 0).toFixed(6)} | run totals: ${totals.calls} calls, $${totals.cost.toFixed(4)}, ${elapsedS()}s elapsed`);
    return Object.assign({}, best, { race: ctx.report });
  } finally {
    clearTimeout(callTimer);
  }
}

function _reset() {
  RUN_START = Date.now();
  health.clear(); providerDead.clear(); skritimaiBase = null;
  totals.calls = 0; totals.cost = 0; totals.tokensIn = 0; totals.tokensOut = 0;
}

module.exports = {
  askAI, PROVIDERS, DEFAULT_ORDER, BudgetError,
  _state: { health, providerDead, totals },
  _reset,
};
