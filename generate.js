// generate.js — agentic code generator (v3: comment-driven rebuilds, live status comment, JSON output)
const { Octokit } = require('@octokit/rest');

const PROJECTS_DIR  = 'projects';
const MANIFEST_PATH = 'projects.json';
const PROGRESS_PATH = 'progress.json';
const POLL_POST     = 'https://text.pollinations.ai/openai';

const MAX_TOKENS     = 12000;   // output budget so full apps are not cut off
const EXISTING_LIMIT = 30000;   // chars of current HTML sent for improve/fix/audit
const PROGRESS_EVERY = 20000;   // ms, throttle for progress.json commits
const STATUS_EVERY   = 5000;    // ms, throttle for editing the live status comment

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const RUN_ID = process.env.RUN_ID || String(Date.now());
if (!OWNER || !REPO) { console.error('GITHUB_REPOSITORY not set'); process.exit(1); }

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/* ============================================================
   PROGRESS TRACKER
   - progress.json: committed (throttled), for the web page
   - status comment: ONE issue comment edited in place (no commits, always fresh)
   ============================================================ */
const T0 = Date.now();
const steps = [];
let currentDraft = '';
let currentError = null;
let currentIssue = null;
let statusCommentId = null;
let statusHeader = '';
let statusDone = false;
let lastPush = 0;
let lastStatus = 0;
const started = new Date().toISOString();

function icon(s) { return s.status === 'done' ? '✅' : s.status === 'error' ? '❌' : '⏳'; }
function stepLine(s) {
  return `${icon(s)} ${s.name}${s.sec != null ? ` — ${s.sec}s` : ''}${s.error ? ` — ${String(s.error).slice(0, 100)}` : ''}`;
}
function elapsed() { return Math.round((Date.now() - T0) / 1000); }

async function updateStatusComment(force) {
  if (!statusCommentId || statusDone) return;
  if (!force && Date.now() - lastStatus < STATUS_EVERY) return;
  lastStatus = Date.now();
  const lines = steps.filter(s => s.name !== 'Error').slice(-10).map(stepLine);
  const body = `${statusHeader}\n\n${lines.join('\n')}\n\n_elapsed ${elapsed()}s · run ${RUN_ID}_`;
  try { await octokit.issues.updateComment({ owner: OWNER, repo: REPO, comment_id: statusCommentId, body }); }
  catch (e) { console.log('[status] update failed:', e.message); }
}

async function startStatusComment(issue, header) {
  if (!issue) return;
  statusHeader = header;
  try {
    const { data } = await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body: `${header}\n\n_starting…_` });
    statusCommentId = data.id;
  } catch (e) { console.log('[status] create failed:', e.message); }
}

// Replace the live status comment with the final message (or post one if none exists).
async function finishStatus(issue, body, close) {
  if (!issue) return;
  statusDone = true;
  const details = `<details><summary>Steps · ${elapsed()}s total</summary>\n\n${steps.filter(s => s.name !== 'Error').map(s => '- ' + stepLine(s)).join('\n')}\n\n</details>`;
  const full = `${body}\n\n${details}`;
  try {
    if (statusCommentId) await octokit.issues.updateComment({ owner: OWNER, repo: REPO, comment_id: statusCommentId, body: full });
    else await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body: full });
    if (close) await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' });
  } catch (e) { console.log('[status] finish failed:', e.message); }
}

async function pushProgress(update = {}, force = false) {
  await updateStatusComment(force || !!update.status);
  const mustPush = force || update.status || currentError;
  if (!mustPush && Date.now() - lastPush < PROGRESS_EVERY) return;
  lastPush = Date.now();
  const payload = {
    runId: RUN_ID, started, updated: new Date().toISOString(),
    status: currentError ? 'error' : (update.status || 'running'),
    issue: currentIssue, statusCommentId,
    steps, draft: currentDraft.slice(0, 8000), draftSize: currentDraft.length,
    error: currentError, ...update,
  };
  try {
    await writeFile(PROGRESS_PATH, JSON.stringify(payload, null, 2),
      `chore(progress): ${steps[steps.length - 1]?.name || 'init'}`);
  } catch (e) { console.log('[progress] write failed:', e.message); }
}

async function step(name, fn, meta = {}) {
  const t0 = Date.now();
  const s = { name, status: 'running', at: new Date().toISOString(), ...meta };
  steps.push(s); await pushProgress();
  try {
    const result = await fn();
    s.status = 'done'; s.sec = Math.round((Date.now() - t0) / 1000); s.at = new Date().toISOString();
    await pushProgress(); return result;
  } catch (e) {
    s.status = 'error'; s.sec = Math.round((Date.now() - t0) / 1000);
    s.error = String(e.message || e).slice(0, 300);
    s.at = new Date().toISOString(); await pushProgress({}, true); throw e;
  }
}

/* ============================================================
   RULES + VALIDATOR
   ============================================================ */
const RULES = `Build a PURE VANILLA JAVASCRIPT single-page app.
STRICT RULES:
- ONE complete HTML file. Inline all CSS in <style>, all JS in <script>.
- NO frameworks or UI libraries of any kind.
- NO external URLs: no CDN scripts, no external fonts, no external images.
- NO import/export/require. NO fetch/XHR at runtime.
- Use ONLY: DOM APIs, CSS, localStorage, sessionStorage, Canvas, SVG, emoji.
- System fonts only (system-ui, Georgia, ui-monospace, Menlo).
- Always escape user input with textContent — never innerHTML for untrusted data.
- Add rel="noopener" to any target="_blank" link.
- Never declare unused variables or parameters. If a caught error is not used, write catch { ... } with no binding.
- Keep the app compact enough to finish in one response; the file MUST end with </html>.
OUTPUT FORMAT: reply with ONLY one JSON object and nothing else: {"html": "<the complete HTML file as a single JSON string>"}
The HTML inside must start with <!DOCTYPE html> and end with </html>. Escape double quotes as \\" and newlines as \\n so the JSON is valid. No markdown fences, no commentary.

`;

// Only patterns that indicate REAL usage (no bare words like "react"/"vue").
const FORBIDDEN = [
  /<script[^>]+src\s*=\s*["']https?:\/\//i,
  /<link[^>]+href\s*=\s*["']https?:\/\//i,
  /\balpine\.?js\b/i, /\bhtmx\b/i, /\bjquery\b/i,
  /\bbootstrap(\.min)?\.(css|js)\b/i, /cdn\.tailwindcss/i,
  /font-?awesome/i, /unpkg\.com/i, /cdn\.jsdelivr\.net/i, /cdnjs\.cloudflare\.com/i,
  /\bfrom\s+["']react["']/i, /\bReactDOM\b/, /\bnew\s+Vue\s*\(/, /\bcreateApp\s*\(/,
  /^\s*import\s+[\w{}\*\s,]+\s+from\s+["']/m, /\brequire\s*\(\s*["']/,
];

function stripComments(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
}

function isVanilla(html) {
  const code = stripComments(html);
  for (const re of FORBIDDEN) if (re.test(code)) return { ok: false, hit: String(re) };
  return { ok: true, hit: null };
}

function stripFences(t) {
  t = String(t || '').trim();
  t = t.replace(/^```(?:json|JSON|html|HTML)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  // JSON envelope: {"html": "..."}  (falls back to raw HTML if the model ignored the format)
  const k = t.indexOf('{');
  if (k !== -1 && k < 20 && /"html"\s*:/.test(t.slice(0, 80))) {
    const body = t.slice(k);
    let extracted = null;
    try {
      const j = JSON.parse(body);
      if (j && typeof j.html === 'string') extracted = j.html;
    } catch {
      // Salvage JSON with raw newlines inside the string value.
      const m = body.match(/"html"\s*:\s*"([\s\S]*)"\s*\}?\s*$/);
      if (m) { try { extracted = JSON.parse('"' + m[1].replace(/\r?\n/g, '\\n') + '"'); } catch {} }
    }
    t = extracted === null ? '' : extracted; // never pass escaped JSON text on as HTML
  }
  const i = t.search(/<!DOCTYPE|<html/i);
  if (i > 0) t = t.slice(i);
  const j = t.lastIndexOf('</html>');
  if (j > 0) t = t.slice(0, j + 7);
  return t.trim();
}

// Must be complete (ends with </html>) so truncated output is rejected.
function isUsable(html) {
  return /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html)
    && /<\/html>\s*$/i.test(html) && html.length > 500;
}

/* ============================================================
   AI PROVIDERS
   ============================================================ */
async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}
const SYS_PROMPT = 'You reply with a single valid JSON object only, in the form {"html": "<complete HTML file as a JSON string>"}. The HTML starts with <!DOCTYPE html> and ends with </html>. No markdown fences, no other text.';

// 400/401/402/403/404 will not fix themselves on retry, so mark them fatal (skip the retry).
function httpErr(status, text) {
  const e = new Error(`HTTP ${status}: ${String(text || '').slice(0, 200)}`);
  e.fatal = [400, 401, 402, 403, 404].includes(status);
  return e;
}

/* 1. Hugging Face */
async function callHuggingFace(prompt) {
  const token = process.env.HF_TOKEN;
  if (!token) { const e = new Error('HF_TOKEN secret is missing'); e.fatal = true; throw e; }
  const res = await withTimeout(fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      model: process.env.HF_MODEL || 'Qwen/Qwen2.5-Coder-32B-Instruct',
      messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: prompt }],
      max_tokens: MAX_TOKENS
    }),
  }), 180000, 'HuggingFace');
  if (!res.ok) throw httpErr(res.status, await res.text());
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text || text.length < 100) throw new Error('Empty or very short response');
  return text;
}

/* 2. OpenRouter (free models looked up live; optional OPENROUTER_MODEL goes first) */
async function callOpenRouter(prompt) {
  const token = process.env.OPENROUTER_API_KEY;
  if (!token) { const e = new Error('OPENROUTER_API_KEY secret is missing'); e.fatal = true; throw e; }

  let models = [];
  try {
    const r = await withTimeout(fetch('https://openrouter.ai/api/v1/models'), 20000, 'OpenRouter-models');
    const list = (await r.json()).data || [];
    const free = list.filter(m => /:free$/.test(m.id) && Number(m.context_length || 0) >= 16000);
    const pref = [/qwen.*coder/i, /deepseek/i, /llama-3\.3/i, /qwen/i, /gemma/i, /mistral/i];
    const rank = id => { const i = pref.findIndex(p => p.test(id)); return i === -1 ? 99 : i; };
    free.sort((a, b) => rank(a.id) - rank(b.id));
    models = free.slice(0, 4).map(m => m.id);
  } catch (e) { console.log('[OpenRouter] model list failed:', e.message); }
  if (process.env.OPENROUTER_MODEL) models.unshift(process.env.OPENROUTER_MODEL);
  if (!models.length) models = ['qwen/qwen-2.5-coder-32b-instruct']; // paid slug, needs credits
  console.log('[OpenRouter] trying models:', models.join(', '));

  let lastErr; let allFatal = true;
  for (const model of models) {
    try {
      const res = await withTimeout(fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'HTTP-Referer': 'https://suryasticsai.github.io/Ariotica/',
          'X-Title': 'Ariotica'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: prompt }],
          max_tokens: MAX_TOKENS,
        }),
      }), 180000, 'OpenRouter');

      if (!res.ok) throw httpErr(res.status, await res.text());
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (!text || text.length < 100) throw new Error('Empty or very short response');
      console.log(`[OpenRouter] ok with ${model}`);
      return text;
    } catch (e) {
      lastErr = e;
      if (!e.fatal) allFatal = false;
      console.log(`[OpenRouter] Model ${model} failed: ${e.message}`);
    }
  }
  lastErr.fatal = allFatal; // if every model gave a 4xx, a second pass is pointless
  throw lastErr;
}

/* 3. Pollinations POST */
async function callPollinationsPost(prompt) {
  const res = await withTimeout(fetch(POLL_POST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Referer': 'https://suryasticsai.github.io/Ariotica/' },
    body: JSON.stringify({
      model: 'openai',
      messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  }), 180000, 'Pollinations-POST');
  if (!res.ok) throw httpErr(res.status, '');
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || data.text || '';
  if (!text || text.length < 100) throw new Error('Empty response');
  return text;
}

async function askAI(prompt) {
  const all = {
    huggingface: ['HuggingFace', callHuggingFace],
    openrouter: ['OpenRouter', callOpenRouter],
    pollinations: ['Pollinations-POST', callPollinationsPost],
  };
  // PROVIDER_ORDER (repo variable) lets you pin what works first, e.g. "openrouter,pollinations"
  const order = (process.env.PROVIDER_ORDER || 'huggingface,openrouter,pollinations')
    .split(',').map(x => x.trim().toLowerCase()).filter(x => all[x]);
  const providers = order.map(k => all[k]);
  const errors = [];
  for (const [name, fn] of providers) {
    for (let i = 1; i <= 2; i++) {
      const t0 = Date.now();
      const s = { name: `${name} · attempt ${i}`, status: 'running', at: new Date().toISOString() };
      steps.push(s);
      await pushProgress();
      try {
        console.log(`[${name}] attempt ${i}/2 ...`);
        const text = await fn(prompt);
        s.status = 'done'; s.at = new Date().toISOString(); s.chars = text.length;
        s.sec = Math.round((Date.now() - t0) / 1000);
        await pushProgress();
        return { text, provider: name };
      } catch (e) {
        const msg = String(e.message || e).slice(0, 220);
        errors.push(`${name} #${i}: ${msg}`);
        console.log(`[${name}] attempt ${i} failed after ${Math.round((Date.now() - t0) / 1000)}s: ${msg}`);
        s.status = 'error'; s.error = msg; s.at = new Date().toISOString();
        s.sec = Math.round((Date.now() - t0) / 1000);
        await pushProgress();
        if (e.fatal) break;                       // retrying a 4xx is pointless
        if (i < 2) await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  throw new Error('All providers failed:\n' + errors.join('\n'));
}

/* ============================================================
   SECURITY SCANNERS
   ============================================================ */
function customAudit(html) {
  const findings = [];
  if (/\.innerHTML\s*=\s*(?!['"`])/.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'innerHTML from variable' });
  if (/\beval\s*\(/.test(html) || /\bnew\s+Function\s*\(/.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'eval/Function' });
  if (/document\.write\s*\(/.test(html)) findings.push({ sev: 'medium', type: 'custom', msg: 'document.write()' });
  const inline = html.match(/on\w+\s*=\s*["'][^"']*["']/gi) || [];
  if (inline.filter(h => /eval|Function|innerHTML/i.test(h)).length) findings.push({ sev: 'medium', type: 'custom', msg: 'suspicious inline handler' });
  if (/(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'hardcoded secret' });
  if (/<form[^>]+action\s*=\s*["']https?:\/\//i.test(html)) findings.push({ sev: 'medium', type: 'custom', msg: 'external form action' });
  if (/target\s*=\s*["']_blank["'](?![^>]*rel\s*=\s*["'][^"']*noopener)/i.test(html)) findings.push({ sev: 'low', type: 'custom', msg: 'no rel=noopener' });
  return findings;
}
async function eslintAudit(html) {
  const findings = [];
  try {
    const { Linter } = require('eslint'); const linter = new Linter();
    const blocks = []; const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m;
    while ((m = re.exec(html)) !== null) blocks.push(m[1]);
    if (!blocks.length) return findings;
    const rules = { 'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error', 'no-script-url': 'error', 'no-unused-vars': 'warn', 'no-undef': 'off', 'no-dupe-keys': 'error' };
    let idx = 0;
    for (const code of blocks) {
      idx++;
      const msgs = linter.verify(code, { languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { window: 'readonly', document: 'readonly', console: 'readonly', localStorage: 'readonly' } }, rules });
      for (const msg of msgs) findings.push({ sev: msg.severity === 2 ? 'high' : 'medium', type: 'eslint', msg: `[script#${idx}:${msg.line}] ${msg.message}` });
    }
  } catch (e) { console.log('eslint failed:', e.message); }
  return findings;
}
async function sparrowAudit(html) {
  const findings = [];
  try {
    const fs = require('fs'), path = require('path'), os = require('os');
    const tmp = path.join(os.tmpdir(), `ariotica-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    let scan; try { scan = require('sparrow-sast').scan; } catch { fs.unlinkSync(tmp); return findings; }
    const issues = await scan(tmp, { useBuiltinCheckers: true, languages: ['javascript', 'html'] });
    for (const issue of issues) findings.push({ sev: issue.severity === 'error' ? 'high' : 'medium', type: 'sparrow', msg: issue.message });
    fs.unlinkSync(tmp);
  } catch (e) { console.log('sparrow failed:', e.message); }
  return findings;
}
async function runAllScanners(html) {
  const results = { custom: [], eslint: [], sparrow: [] };
  results.custom = customAudit(html);
  try { results.eslint = await eslintAudit(html); } catch {}
  try { results.sparrow = await sparrowAudit(html); } catch {}
  const all = [...results.custom, ...results.eslint, ...results.sparrow];
  const seen = new Set(); const deduped = [];
  for (const f of all) { const k = f.type + ':' + f.msg.slice(0, 80); if (!seen.has(k)) { seen.add(k); deduped.push(f); } }
  return {
    findings: deduped,
    counts: { total: deduped.length, high: deduped.filter(f => f.sev === 'high').length, medium: deduped.filter(f => f.sev === 'medium').length, low: deduped.filter(f => f.sev === 'low').length, byTool: { custom: results.custom.length, eslint: results.eslint.length, sparrow: results.sparrow.length } }
  };
}

/* ============================================================
   HELPERS & MAIN
   ============================================================ */
const TAGS = 'improve|fix|audit|delete';

// Reads the build request. Returns null when a comment carries no [tag] (it is ignored).
//  - Issue opened:   title "[BUILD] name [improve|fix|audit|delete]", body = prompt
//  - Issue comment:  "[fix] fix those scanner issues"  or  "make cards bigger [improve]"
//  - Manual dispatch: project / prompt / mode inputs
function resolveInputs() {
  const dProj = (process.env.DISPATCH_PROJECT || '').trim();
  if (dProj) return { project: dProj, prompt: (process.env.DISPATCH_PROMPT || '').trim(), mode: (process.env.DISPATCH_MODE || 'create').toLowerCase(), issue: null, commentId: null };

  const title = process.env.ISSUE_TITLE || '', num = parseInt(process.env.ISSUE_NUMBER || '0', 10);
  const tm = title.match(new RegExp(`^\\[BUILD\\]\\s+([A-Za-z0-9 _-]+?)(?:\\s*\\[(${TAGS})\\])?\\s*$`));
  if (!tm) throw new Error('Title must be: [BUILD] name [improve|fix|audit|delete]');

  if ((process.env.EVENT_NAME || '') === 'issue_comment') {
    // drop quoted lines ("> ...") so Quote-reply on the bot comment still works
    const body = (process.env.COMMENT_BODY || '').split('\n').filter(l => !/^\s*>/.test(l)).join('\n').trim();
    let mode = null, prompt = '';
    const first = body.match(new RegExp(`^\\[(${TAGS})\\]\\s*([\\s\\S]*)$`, 'i'));
    const last = body.match(new RegExp(`^([\\s\\S]*?)\\s*\\[(${TAGS})\\]\\s*$`, 'i'));
    if (first) { mode = first[1]; prompt = first[2]; }
    else if (last) { mode = last[2]; prompt = last[1]; }
    if (!mode) return null;
    return { project: tm[1].trim(), prompt: prompt.trim(), mode: mode.toLowerCase(), issue: num || null, commentId: parseInt(process.env.COMMENT_ID || '0', 10) || null };
  }

  return { project: tm[1].trim(), prompt: (process.env.ISSUE_BODY || '').trim(), mode: (tm[2] || 'create').toLowerCase(), issue: num || null, commentId: null };
}
function slugify(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

async function readFile(path) {
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH }); if (Array.isArray(data)) return null; return Buffer.from(data.content, 'base64').toString('utf8'); } catch (e) { if (e.status === 404) return null; throw e; }
}
async function writeFile(path, content, message) {
  let sha = null; try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH }); if (!Array.isArray(data)) sha = data.sha; } catch (e) { if (e.status !== 404) throw e; }
  await octokit.repos.createOrUpdateFileContents({ owner: OWNER, repo: REPO, path, message, content: Buffer.from(content, 'utf8').toString('base64'), branch: BRANCH, ...(sha ? { sha } : {}) });
}
async function deleteFile(path, message) {
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH }); if (Array.isArray(data)) return false; await octokit.repos.deleteFile({ owner: OWNER, repo: REPO, path, message, sha: data.sha, branch: BRANCH }); return true; } catch (e) { if (e.status === 404) return false; throw e; }
}

function tokenize(s) { return String(s || '').toLowerCase().match(/\w+/g) || []; }
function similarity(a, b) { const ta = new Set(tokenize(a)), tb = new Set(tokenize(b)); let inter = 0; for (const t of ta) if (tb.has(t)) inter++; const u = ta.size + tb.size - inter; return u === 0 ? 0 : inter / u; }
async function buildRagContext(prompt, manifest, currentSlug) {
  if (!manifest || manifest.length < 2) return { ctx: '', refs: [] };
  const scored = manifest.filter(e => e.project !== currentSlug).map(e => ({ ...e, score: similarity(prompt, e.prompt || '') })).sort((a, b) => b.score - a.score).slice(0, 2).filter(e => e.score > 0.15);
  if (!scored.length) return { ctx: '', refs: [] };
  let ctx = '\n\nREFERENCE APPS (style hints only):\n'; const refs = [];
  for (const e of scored) { const f = await readFile(e.file); if (!f) continue; refs.push(e.project); ctx += `\n--- ${e.project} ---\n${f.slice(0, 2500)}\n`; }
  return { ctx, refs };
}

const HINT = '\n\n💬 Reply to this issue with `[improve] …`, `[fix] …`, `[audit]` or `[delete]` to change it.';
const MENTIONS_SCAN = /\b(sonar|scan|scanner|lint|security|findings?|warnings?|issues?)\b/i;

async function main() {
  const inputs = resolveInputs();
  if (!inputs) { console.log('Comment has no [improve|fix|audit|delete] tag - ignoring.'); return; }
  const { project, prompt, mode, issue, commentId } = inputs;
  currentIssue = issue;

  await pushProgress({ status: 'running' });
  await step('Parse request', async () => inputs);
  const slug = slugify(project);
  if (!slug) throw new Error('Project name needs at least one letter or digit');
  const filename = `${PROJECTS_DIR}/${slug}.html`;

  if (commentId) {
    try { await octokit.reactions.createForIssueComment({ owner: OWNER, repo: REPO, comment_id: commentId, content: 'eyes' }); } catch (e) { console.log('[reaction] failed:', e.message); }
    try { await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'open' }); } catch {}
  }
  const quoted = prompt ? `\n> ${prompt.slice(0, 200).replace(/\n/g, ' ')}` : '';
  await startStatusComment(issue, `⏳ **Working on it** — \`${mode}\` on \`${slug}\`${quoted}`);

  let manifest = [];
  try { const raw = await readFile(MANIFEST_PATH); if (raw) manifest = JSON.parse(raw); if (!Array.isArray(manifest)) manifest = []; } catch { manifest = []; }

  if (mode === 'delete') {
    const existed = (await deleteFile(filename, `chore: delete ${slug}`)) || (await deleteFile(`${slug}.html`, `chore: delete legacy ${slug}`));
    manifest = manifest.filter(e => e.project !== slug);
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'chore: manifest');
    await finishStatus(issue, existed ? `🗑 Deleted \`${slug}\`.` : `\`${slug}\` did not exist.`, true);
    await pushProgress({ status: 'done' }); return;
  }

  let existing = await readFile(filename); let legacyPath = null;
  if (!existing) { const legacy = await readFile(`${slug}.html`); if (legacy) { existing = legacy; legacyPath = `${slug}.html`; } }
  if ((mode === 'improve' || mode === 'fix' || mode === 'audit') && !existing) throw new Error(`Cannot ${mode} "${slug}": no existing file.`);

  let ask;
  if (mode === 'create' || (!existing && mode !== 'fix' && mode !== 'audit')) ask = existing ? 'Improve the existing app. Keep what works and apply: ' + prompt : prompt;
  else if (mode === 'improve') ask = 'Improve the existing app. Keep what works and apply: ' + prompt;
  else if (mode === 'fix') ask = `Fix ONLY the bug or issues described.\n\nBUG: ${prompt || 'see scanner findings below'}`;
  else if (mode === 'audit') {
    const initialFindings = await step('Initial security scan', () => runAllScanners(existing));
    if (!initialFindings.findings.length && !prompt) {
      await finishStatus(issue, '✅ Audit clean — nothing to fix.', true);
      await pushProgress({ status: 'done' }); return;
    }
    const report = initialFindings.findings.length ? initialFindings.findings.map(f => `- [${f.sev}] ${f.msg}`).join('\n') : '(none)';
    ask = `Fix the security issues.\n\nFINDINGS:\n${report}\n\nEXTRA: ${prompt || 'none'}`;
  }

  // "[fix] fix those sonar/scan issues": re-scan the current file and hand the findings to the model.
  if (existing && (mode === 'fix' || mode === 'improve') && (MENTIONS_SCAN.test(prompt) || (mode === 'fix' && !prompt))) {
    const sc = await step('Scan current code', () => runAllScanners(existing));
    if (sc.findings.length) ask += '\n\nSCANNER FINDINGS TO FIX (from the latest scan of the current code):\n' + sc.findings.map(f => `- [${f.sev}] ${f.msg}`).join('\n');
  }
  if (mode === 'fix' || mode === 'audit') ask += '\n\nReturn the complete fixed HTML.';

  const { ctx: ragCtx, refs } = await step('Build RAG context', () => (mode === 'create' || mode === 'improve') ? buildRagContext(prompt, manifest, slug) : Promise.resolve({ ctx: '', refs: [] }));
  let fullPrompt = RULES + ask + ragCtx;
  if (existing) {
    if (existing.length > EXISTING_LIMIT) console.log(`[warn] existing file is ${existing.length} chars; sending first ${EXISTING_LIMIT}`);
    fullPrompt += '\n\nCURRENT HTML:\n' + existing.slice(0, EXISTING_LIMIT);
  }

  const { text, provider } = await step('Generate with AI', () => askAI(fullPrompt), { promptChars: fullPrompt.length, ragRefs: refs.join(', ') || 'none' });

  let html = stripFences(text);

  if (!isUsable(html)) {
    currentDraft = html; await pushProgress({}, true);
    const strict = 'Previous attempt did not return a valid, COMPLETE HTML file (it was cut off or malformed). Reply with ONLY the JSON object {"html": "..."} whose HTML starts with <!DOCTYPE html> and ends with </html>. Make the app more compact so it fits.\n\n' + fullPrompt;
    const r = await step('Retry (unusable HTML)', () => askAI(strict));
    html = stripFences(r.text);
    if (!isUsable(html)) {
      console.log(`[debug] provider=${r.provider} length=${html.length}`);
      console.log('[debug] has <html>:', /<html[\s>]/i.test(html), '| has <body>:', /<body[\s>]/i.test(html), '| ends with </html>:', /<\/html>\s*$/i.test(html));
      console.log('[debug] HEAD:', html.slice(0, 300).replace(/\n/g, '\\n'));
      console.log('[debug] TAIL:', html.slice(-300).replace(/\n/g, '\\n'));
      currentDraft = html;
      throw new Error(`Still unusable HTML from ${r.provider} (length ${html.length}, ends with </html>: ${/<\/html>\s*$/i.test(html)})`);
    }
  }

  let check = isVanilla(html);
  if (!check.ok) {
    currentDraft = html; await pushProgress({}, true);
    const strict = `Previous attempt used a forbidden library or external URL (matched ${check.hit}). Regenerate with ONLY vanilla JavaScript. No frameworks, no CDNs, no external URLs.\n\n` + fullPrompt;
    const r = await step('Retry (vanilla enforcement)', () => askAI(strict));
    html = stripFences(r.text);
    if (!isUsable(html)) throw new Error('Retry produced unusable HTML');
    check = isVanilla(html);
    if (!check.ok) throw new Error(`Still non-vanilla (matched ${check.hit})`);
  }

  const security = await step('Security scan', () => runAllScanners(html));
  await step(`Commit ${filename}`, () => writeFile(filename, html, `feat: ${slug} (${mode})`));
  if (legacyPath && mode !== 'create') { try { await deleteFile(legacyPath, 'chore: migrate'); } catch {} }

  const idx = manifest.findIndex(e => e.project === slug);
  const entry = { project: slug, file: filename, prompt: prompt.slice(0, 240), created: new Date().toISOString().slice(0, 19), mode, provider, findings: security.counts.total, size: html.length };
  if (idx === -1) manifest.push(entry); else manifest[idx] = Object.assign({}, manifest[idx], entry);
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'chore: manifest');

  const url = `https://${OWNER}.github.io/${REPO}/${filename}`;
  let body = `✅ **${mode}** complete: \`${filename}\` via **${provider}**\n\nLive in ~1 min: ${url}`;
  if (security.findings.length) body += `\n\n**Scanner findings (${security.findings.length}):**\n` + security.findings.slice(0, 10).map(f => `- [${f.sev}] ${f.msg}`).join('\n');
  body += HINT;
  await finishStatus(issue, body, true);
  await pushProgress({ status: 'done', securitySummary: security.counts });
}

main().catch(async (err) => {
  console.error('ERROR:', err.message);
  currentError = String(err.message).slice(0, 1000);
  steps.push({ name: 'Error', status: 'error', error: currentError, at: new Date().toISOString() });
  await pushProgress({ status: 'error' }, true);
  const num = currentIssue || parseInt(process.env.ISSUE_NUMBER || '0', 10);
  if (num && OWNER && REPO) await finishStatus(num, `❌ **Failed**\n\n\`\`\`\n${currentError.slice(0, 1500)}\n\`\`\`${HINT}`, false);
  process.exit(1);
});
