'use strict';
const http = require('http');
const assert = require('assert');
const P = require('../lib/providers');

// ---------- mock server ----------
const hits = {};        // path -> array of parsed request bodies
const script = {};      // path -> array of handlers (consumed in order; last one repeats)
let PORT;
const json = (res, status, obj, headers = {}) => { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers)); res.end(JSON.stringify(obj)); };
const okReply = (text, extra = {}) => (req, res) => json(res, 200, Object.assign({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }, extra));
const status = (code, body = 'err', headers = {}) => (req, res) => { res.writeHead(code, Object.assign({ 'Content-Type': 'text/plain' }, headers)); res.end(body); };
const sse = (chunks, delay = 5) => async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const c of chunks) { res.write(c); await new Promise((r) => setTimeout(r, delay)); }
  res.end();
};
const server = http.createServer((req, res) => {
  let data = '';
  req.on('data', (d) => (data += d));
  req.on('end', () => {
    const path = req.url.split('?')[0];
    let body = null; try { body = JSON.parse(data); } catch { }
    (hits[path] = hits[path] || []).push(body);
    const q = script[path];
    if (!q || !q.length) return json(res, 500, { error: 'no script for ' + path });
    const h = q.length > 1 ? q.shift() : q[0];
    h(req, res, body);
  });
});

const FULL = 'x'.repeat(40) + ' {"files":{"index.html":"<html></html>"}}';
const resetAll = () => {
  for (const k of Object.keys(hits)) delete hits[k];
  for (const k of Object.keys(script)) delete script[k];
  for (const k of Object.keys(process.env)) if (/^(SKRITIMAI|GROQ|OPENROUTER|HF|RUN_BUDGET|ASK_TIMEOUT|PROVIDER_ORDER|RACE_SIZE)/.test(k)) delete process.env[k];
  Object.assign(process.env, {
    GROQ_API_KEY: 'g', GROQ_URL: `http://127.0.0.1:${PORT}/groq`, GROQ_MODEL: 'openai/gpt-oss-120b',
    OPENROUTER_API_KEY: 'o', OPENROUTER_URL: `http://127.0.0.1:${PORT}/or`, OPENROUTER_MODEL: 'free/m',
    SKRITIMAI_API_KEY: 's', SKRITIMAI_BASE_URL: `http://127.0.0.1:${PORT}/sk/v1`,
  });
  P._reset();
};
const n = (p) => (hits[p] || []).length;
const msgs = [{ role: 'user', content: 'hi' }];
const passGrade = async () => ({ ok: true, score: 100 });
const failGrade = async () => ({ ok: false, score: 40, reason: '2 runtime/check error(s)', smoke: { errors: ['x is not defined', 'y failed'] } });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('graded failure is returned for repair; no fallback to OpenRouter', async () => {
  script['/groq'] = [okReply(FULL)]; script['/or'] = [okReply(FULL)];
  const r = await P.askAI(msgs, { json: true, grade: failGrade });
  assert.equal(r.provider, 'Groq'); assert.equal(r.grade.ok, false); assert.equal(n('/or'), 0);
  assert.equal(r.tokensIn, 100); assert.equal(r.tokensOut, 50);
  assert.ok(r.race[0].tokensIn === 100 && r.race[0].tokensOut === 50, 'race report carries tokens');
});

test('429 with short Retry-After waits once and retries the SAME model', async () => {
  script['/groq'] = [status(429, '{"error":"tpm"}', { 'retry-after': '1' }), okReply(FULL)];
  const t0 = Date.now();
  const r = await P.askAI(msgs, { grade: passGrade });
  assert.equal(r.provider, 'Groq'); assert.equal(n('/groq'), 2); assert.equal(n('/or'), 0);
  assert.ok(Date.now() - t0 >= 900);
});

test('429 with long Retry-After falls through at once, and later calls skip the cooling model', async () => {
  script['/groq'] = [status(429, '{"error":"tpm"}', { 'retry-after': '60' })]; script['/or'] = [okReply(FULL)];
  let r = await P.askAI(msgs, { grade: passGrade });
  assert.equal(r.provider, 'OpenRouter'); assert.equal(n('/groq'), 1);
  r = await P.askAI(msgs, { grade: passGrade });
  assert.equal(r.provider, 'OpenRouter'); assert.equal(n('/groq'), 1, 'cooling model not hit again');
});

test('Skritimai gated by kind: skipped for generate, used for edit', async () => {
  script['/sk/v1/chat/completions'] = [sse(['data: ' + JSON.stringify({ choices: [{ delta: { content: FULL }, finish_reason: 'stop' }] }) + '\n\n', 'data: [DONE]\n\n'])];
  script['/groq'] = [okReply(FULL)];
  let r = await P.askAI(msgs, { grade: passGrade });
  assert.equal(r.provider, 'Groq'); assert.equal(n('/sk/v1/chat/completions'), 0);
  r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Skritimai'); assert.equal(hits['/sk/v1/chat/completions'][0].model, 'skritimai');
  assert.equal(hits['/sk/v1/chat/completions'][0].stream, true);
  assert.deepEqual(hits['/sk/v1/chat/completions'][0].stream_options, { include_usage: true });
});

test('SSE event split mid-JSON across network chunks is reassembled exactly', async () => {
  const text = 'HELLO ' + 'abcdefghij'.repeat(10) + ' {"ok":true}';
  const events = []; for (let i = 0; i < text.length; i += 7) events.push('data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 7) } }] }) + '\n\n');
  events.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
  events.push('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 9 } }) + '\n\n', 'data: [DONE]\n\n');
  const wire = events.join(''); const chunks = [];
  for (let i = 0; i < wire.length; i += 13) chunks.push(wire.slice(i, i + 13));   // arbitrary cut points
  script['/sk/v1/chat/completions'] = [sse(chunks, 1)];
  const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.text, text); assert.equal(r.tokensIn, 7); assert.equal(r.tokensOut, 9);
});

test('stream error event is a failure (not swallowed); falls back to Groq', async () => {
  script['/sk/v1/chat/completions'] = [sse(['data: {"error":{"message":"boom","code":503}}\n\n'])]; script['/groq'] = [okReply(FULL)];
  const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Groq'); assert.equal(n('/sk/v1/chat/completions'), 1);
});

test('Skritimai 530 kills the provider for the run; fallback used; next call does not touch it', async () => {
  script['/sk/v1/chat/completions'] = [status(530, 'error code: 1033')]; script['/groq'] = [okReply(FULL)];
  let r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Groq'); assert.ok(P._state.providerDead.has('skritimai'));
  r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(n('/sk/v1/chat/completions'), 1);
});

test('refused connection on Skritimai marks the provider dead', async () => {
  process.env.SKRITIMAI_BASE_URL = 'http://127.0.0.1:1/v1'; script['/groq'] = [okReply(FULL)];
  const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Groq'); assert.ok(P._state.providerDead.has('skritimai'));
});

test('slow Skritimai cannot starve the fallback (own time slice)', async () => {
  process.env.SKRITIMAI_TIMEOUT_MS = '700'; process.env.SKRITIMAI_FIRST_TOKEN_MS = '5000';
  script['/sk/v1/chat/completions'] = [(req, res) => { /* never answers */ }]; script['/groq'] = [okReply(FULL)];
  const t0 = Date.now();
  const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Groq'); assert.ok(Date.now() - t0 < 4000);
  assert.equal(P._state.health.get('skritimai/skritimai').strikes, 1);
});

test('truncated replies: strike, strike, then the model is dead for the run', async () => {
  const cut = (req, res) => json(res, 200, { choices: [{ message: { content: FULL }, finish_reason: 'length' }] });
  script['/groq'] = [cut]; script['/or'] = [okReply(FULL)];
  let r = await P.askAI(msgs, { grade: passGrade }); assert.equal(r.provider, 'OpenRouter');
  assert.equal(P._state.health.get('groq/openai/gpt-oss-120b').dead, null);
  r = await P.askAI(msgs, { grade: passGrade }); assert.equal(r.provider, 'OpenRouter'); assert.equal(n('/groq'), 2);
  assert.ok(P._state.health.get('groq/openai/gpt-oss-120b').dead);
  r = await P.askAI(msgs, { grade: passGrade }); assert.equal(n('/groq'), 2);
});

test('one 502 is only a strike for Groq (provider survives)', async () => {
  script['/groq'] = [status(502, 'bad gateway'), okReply(FULL)]; script['/or'] = [okReply(FULL)];
  let r = await P.askAI(msgs, { grade: passGrade }); assert.equal(r.provider, 'OpenRouter');
  r = await P.askAI(msgs, { grade: passGrade }); assert.equal(r.provider, 'Groq');
  assert.equal(P._state.providerDead.size, 0);
});

test('401 from a provider disables it for the run', async () => {
  script['/groq'] = [status(401, 'bad key')]; script['/or'] = [okReply(FULL)];
  await P.askAI(msgs, { grade: passGrade }); assert.ok(P._state.providerDead.has('groq'));
});

test('decommissioned model (400) is dead immediately', async () => {
  script['/groq'] = [status(400, '{"error":{"message":"The model `x` has been decommissioned"}}')]; script['/or'] = [okReply(FULL)];
  await P.askAI(msgs, { grade: passGrade });
  assert.ok(P._state.health.get('groq/openai/gpt-oss-120b').dead);
});

test('error hidden in a 200 body (code 429) becomes a cooldown', async () => {
  script['/groq'] = [(req, res) => json(res, 200, { error: { code: 429, message: 'rate limited' } })]; script['/or'] = [okReply(FULL)];
  const r = await P.askAI(msgs, { grade: passGrade }); assert.equal(r.provider, 'OpenRouter');
  assert.ok(P._state.health.get('groq/openai/gpt-oss-120b').cooldownUntil > Date.now());
});

test('run budget aborts an in-flight request and throws BudgetError; later calls throw at once', async () => {
  process.env.RUN_BUDGET_MS = '1200';
  script['/groq'] = [(req, res) => setTimeout(() => okReply(FULL)(req, res), 6000)]; script['/or'] = [(req, res) => setTimeout(() => okReply(FULL)(req, res), 6000)];
  const t0 = Date.now();
  await assert.rejects(() => P.askAI(msgs, { grade: passGrade }), (e) => e instanceof P.BudgetError);
  assert.ok(Date.now() - t0 < 3000, 'aborted promptly');
  const t1 = Date.now();
  await assert.rejects(() => P.askAI(msgs, { grade: passGrade }), (e) => e.budget === true);
  assert.ok(Date.now() - t1 < 100);
});

test('opts.maxTokens and GROQ_REASONING_EFFORT reach the request body', async () => {
  process.env.GROQ_REASONING_EFFORT = 'low'; script['/groq'] = [okReply(FULL)];
  await P.askAI(msgs, { grade: passGrade, maxTokens: 2000, json: true });
  const b = hits['/groq'][0]; assert.equal(b.max_tokens, 2000); assert.equal(b.reasoning_effort, 'low'); assert.deepEqual(b.response_format, { type: 'json_object' });
});

test('PROVIDER_ORDER and RACE_SIZE are honoured (race: first passing reply wins)', async () => {
  process.env.PROVIDER_ORDER = 'openrouter,groq'; process.env.RACE_SIZE = '2';
  script['/groq'] = [(req, res) => setTimeout(() => okReply(FULL)(req, res), 400)]; script['/or'] = [okReply(FULL)];
  const r = await P.askAI(msgs, { grade: passGrade }); assert.equal(r.provider, 'OpenRouter');
});

test('gist: offline engine disables Skritimai instantly, without touching the tunnel', async () => {
  process.env.SKRITIMAI_GIST_URL = `http://127.0.0.1:${PORT}/gist`; delete process.env.SKRITIMAI_BASE_URL;
  script['/gist'] = [(req, res) => json(res, 200, { status: 'offline', url: null, updated_at: new Date().toISOString() })]; script['/groq'] = [okReply(FULL)];
  const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Groq'); assert.ok(P._state.providerDead.has('skritimai')); assert.equal(n('/sk/v1/chat/completions'), 0);
});

test('gist: stale heartbeat is treated as offline', async () => {
  process.env.SKRITIMAI_GIST_URL = `http://127.0.0.1:${PORT}/gist`; delete process.env.SKRITIMAI_BASE_URL;
  script['/gist'] = [(req, res) => json(res, 200, { status: 'online', openai_base_url: `http://127.0.0.1:${PORT}/sk/v1`, updated_at: new Date(Date.now() - 3600e3).toISOString() })]; script['/groq'] = [okReply(FULL)];
  const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Groq'); assert.equal(n('/sk/v1/chat/completions'), 0);
});

test('gist: fresh "online" state uses openai_base_url (the /v1 path the gateway allows)', async () => {
  process.env.SKRITIMAI_GIST_URL = `http://127.0.0.1:${PORT}/gist`; delete process.env.SKRITIMAI_BASE_URL;
  script['/gist'] = [(req, res) => json(res, 200, { status: 'online', url: `http://127.0.0.1:${PORT}/sk`, openai_base_url: `http://127.0.0.1:${PORT}/sk/v1`, updated_at: new Date().toISOString() })];
  script['/sk/v1/chat/completions'] = [sse(['data: ' + JSON.stringify({ choices: [{ delta: { content: FULL }, finish_reason: 'stop' }] }) + '\n\n'])];
  const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' });
  assert.equal(r.provider, 'Skritimai'); assert.equal(n('/gist'), 1);
  await P.askAI(msgs, { grade: passGrade, kind: 'edit' }); assert.equal(n('/gist'), 1, 'gist resolved once per run');
});

test('SKRITIMAI_BASE_URL accepts base, /v1 and full path', async () => {
  for (const base of [`http://127.0.0.1:${PORT}/sk`, `http://127.0.0.1:${PORT}/sk/v1`, `http://127.0.0.1:${PORT}/sk/v1/chat/completions`]) {
    resetAll(); process.env.SKRITIMAI_BASE_URL = base;
    script['/sk/v1/chat/completions'] = [sse(['data: ' + JSON.stringify({ choices: [{ delta: { content: FULL }, finish_reason: 'stop' }] }) + '\n\n'])];
    const r = await P.askAI(msgs, { grade: passGrade, kind: 'edit' }); assert.equal(r.provider, 'Skritimai', base);
  }
});

test('missing key skips a provider; nothing configured gives a clear error', async () => {
  delete process.env.GROQ_API_KEY; delete process.env.OPENROUTER_API_KEY; delete process.env.SKRITIMAI_API_KEY;
  await assert.rejects(() => P.askAI(msgs, { grade: passGrade }), /no provider is configured/);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const realLog = console.log; let failed = 0;
  for (const [name, fn] of tests) {
    resetAll(); const logs = []; console.log = (...a) => logs.push(a.join(' '));
    try { await fn(); console.log = realLog; realLog('  ✓', name); }
    catch (e) { console.log = realLog; failed++; realLog('  ✗', name, '\n    ', e.message.split('\n')[0]); realLog(logs.map((l) => '      | ' + l).join('\n')); }
  }
  realLog(failed ? `\n${failed} FAILED of ${tests.length}` : `\nall ${tests.length} passed`);
  server.close(); process.exit(failed ? 1 : 0);
})();
