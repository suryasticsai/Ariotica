'use strict';
// LLM providers behind one OpenAI-compatible interface, with a model RACE.
const { computeCost } = require('./pricing');

const REFERER = 'https://suryasticsai.github.io/Ariotica/';
const DEFAULT_ORDER = 'groq,openrouter,nemotron,pollinations,huggingface';
const FATAL_STATUS = [400, 401, 402, 403, 404, 413]; // 429 removed: rate-limits are transient
const ACCOUNT_STATUS = [401, 402, 403];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envList(name, defaults) {
  const v = (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return v.length ? v : defaults;
}

function httpErr(status, text) {
  const e = new Error(`HTTP ${status}: ${String(text || '').slice(0, 200)}`);
  e.fatal = FATAL_STATUS.includes(status);
  e.account = ACCOUNT_STATUS.includes(status);
  e.retryAfter = null;
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
      throw new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Free OpenRouter model names change often, so ask which free models exist right now.
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
  if (!models.length) models = ['qwen/qwen-2.5-coder-32b-instruct'];
  console.log('[OpenRouter] trying models:', models.join(', '));
  return models;
}

const PROVIDERS = {
  groq: {
    label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY',
    models: async () => envList('GROQ_MODEL', ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile']),
    timeout: 90000, maxTokens: 8000,
  },
  openrouter: {
    label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: 'OPENROUTER_API_KEY',
    models: openRouterModels, timeout: 120000, maxTokens: 12000,
    headers: { 'HTTP-Referer': REFERER, 'X-Title': 'Ariotica' },
  },
  // ============================================================
  // NEW: NVIDIA Nemotron via OpenRouter (with reasoning)
  // Uses a dedicated NEMOTRON_API_KEY secret so it can be billed/scoped
  // independently from the general OPENROUTER_API_KEY.
  // ============================================================
  nemotron: {
    label: 'Nemotron',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: 'NEMOTRON_API_KEY',
    models: async () => envList('NEMOTRON_MODEL', ['nvidia/nemotron-3.5-content-safety']),
    timeout: 150000,
    maxTokens: 12000,
    reasoning: true, // sends { reasoning: { enabled: true } } on every call
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
  },
};

async function callProvider(id, messages, opts) {
  const cfg = PROVIDERS[id];
  const signal = opts.signal;
  const token = cfg.key ? process.env[cfg.key] : '';
  const models = await cfg.models();
  let lastErr = new Error('no models configured');
  let allFatal = true;
  for (const model of models) {
    if (signal && signal.aborted) throw cancelledError(cfg.label);
    try {
      const body = { model, messages };
      const maxTokens = opts.maxTokens || cfg.maxTokens;
      if (maxTokens) body.max_tokens = maxTokens;
      if (opts.json && cfg.jsonMode) body.response_format = { type: 'json_object' };
      // NEW: enable extended reasoning on providers that support it
      if (cfg.reasoning) body.reasoning = { enabled: true };

      const headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
      if (token) headers.Authorization = `Bearer ${token}`;
      const { res, text } = await fetchWithTimeout(cfg.url,
        { method: 'POST', headers, body: JSON.stringify(body) }, cfg.timeout, `${cfg.label}/${model}`, signal);

      if (!res.ok) {
        const err = httpErr(res.status, text);
        // 429: read Retry-After, wait up to 10s, retry once
        if (res.status === 429) {
          const ra = parseInt(res.headers.get('retry-after') || '4', 10);
          const wait = Math.min(Math.max(ra, 1), 10) * 1000;
          console.log(`[${cfg.label}] 429 on ${model}, retrying in ${wait / 1000}s...`);
          await sleep(wait);
          if (signal && signal.aborted) throw cancelledError(cfg.label);
          const retry = await fetchWithTimeout(cfg.url,
            { method: 'POST', headers, body: JSON.stringify(body) }, cfg.timeout, `${cfg.label}/${model}`, signal);
          if (!retry.res.ok) throw httpErr(retry.res.status, retry.text);
          const rData = JSON.parse(retry.text);
          const rChoice = rData.choices && rData.choices[0];
          const rOut = (rChoice && rChoice.message && rChoice.message.content) || rData.text || '';
          if (!rOut || rOut.length < 20) throw new Error('empty or very short response after retry');
          const rUsage = rData.usage || null;
          const rCost = computeCost(model, rUsage);
          console.log(`[${cfg.label}] ok after retry with ${model} (${rOut.length} chars, finish=${rChoice && rChoice.finish_reason}, tokens=${rCost.tin}/${rCost.tout}, $${rCost.cost.toFixed(6)})`);
          return { text: rOut, model, finish: rChoice && rChoice.finish_reason, usage: rUsage, cost: rCost.cost, tin: rCost.tin, tout: rCost.tout };
        }
        throw err;
      }

      let data;
      try { data = JSON.parse(text); } catch { throw new Error('provider returned non-JSON'); }
      const choice = data.choices && data.choices[0];
      const out = (choice && choice.message && choice.message.content) || data.text || '';
      if (!out || out.length < 20) throw new Error('empty or very short response');

      // Reasoning models may put the visible answer in `content` and the
      // reasoning trace in `reasoning_details`. We only need `content`.
      if (choice && choice.message && choice.message.reasoning_details) {
        console.log(`[${cfg.label}] ${model} returned reasoning (${choice.message.reasoning_details.length} chars) + content (${out.length} chars)`);
      }

      const usage = data.usage || null;
      const { cost, tin, tout } = computeCost(model, usage);
      console.log(`[${cfg.label}] ok with ${model} (${out.length} chars, finish=${choice && choice.finish_reason}, tokens=${tin}/${tout}, $${cost.toFixed(6)})`);
      return { text: out, model, finish: choice && choice.finish_reason, usage, cost, tin, tout };
    } catch (e) {
      if (e.cancelled) throw e;
      lastErr = e;
      if (!e.fatal) allFatal = false;
      console.log(`[${cfg.label}] ${model} failed: ${e.message}`);
      if (e.account) break;
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
      if (e.fatal || attempt === 2) {
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
  const ctx = {
    messages, opts, report: [], errors: [], candidates: [],
    emit: opts.onEvent || (async () => {}),
    grade: opts.grade || (async (t) => ({ ok: String(t).length >= 20, score: 1 })),
  };

  const available = [];
  for (const id of parseOrder()) {
    const cfg = PROVIDERS[id];
    if (cfg.key && !process.env[cfg.key]) { console.log(`[${cfg.label}] skipped: ${cfg.key} not set`); continue; }
    available.push(id);
  }
  if (!available.length) throw new Error('All providers failed:\nno provider is configured');

  const size = Math.min(Math.max(parseInt(process.env.RACE_SIZE || '2', 10) || 1, 1), 5);
  const racers = available.slice(0, size);
  console.log(`[race] ${racers.join(' vs ')}${available.length > size ? `  (fallback: ${available.slice(size).join(', ')})` : ''}`);

  let winner = await race(racers, ctx);
  for (const id of available.slice(size)) {
    if (winner) break;
    try {
      const cand = await runOne(id, new AbortController().signal, ctx, false);
      if (cand.grade.ok) winner = cand;
    } catch { }
  }

  if (winner) console.log(`🏆 [race] winner: ${winner.provider} (${winner.model}) in ${winner.sec}s`);
  const best = winner || ctx.candidates.slice().sort((a, b) => (b.grade.score || 0) - (a.grade.score || 0))[0];
  if (!best) throw new Error('All providers failed:\n' + (ctx.errors.join('\n') || 'no response'));
  if (!winner) console.log(`[race] nobody passed; returning best (${best.provider}, score ${best.grade.score})`);
  return Object.assign({}, best, { race: ctx.report });
}

module.exports = { askAI, PROVIDERS, httpErr, DEFAULT_ORDER };