// generate.js — agentic code generator
const { Octokit } = require('@octokit/rest');

const PROJECTS_DIR  = 'projects';
const MANIFEST_PATH = 'projects.json';
const PROGRESS_PATH = 'progress.json';
const POLL_POST     = 'https://text.pollinations.ai/openai';
const POLL_GET      = 'https://text.pollinations.ai';

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const RUN_ID = process.env.RUN_ID || String(Date.now());
if (!OWNER || !REPO) { console.error('GITHUB_REPOSITORY not set'); process.exit(1); }

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/* ============================================================
   PROGRESS TRACKER
   ============================================================ */
const steps = [];
let currentDraft = '';
let currentError = null;
const started = new Date().toISOString();

async function pushProgress(update = {}) {
  const payload = {
    runId: RUN_ID, started, updated: new Date().toISOString(),
    status: currentError ? 'error' : (update.status || 'running'),
    steps, draft: currentDraft.slice(0, 8000), draftSize: currentDraft.length,
    error: currentError, ...update,
  };
  try {
    await writeFile(PROGRESS_PATH, JSON.stringify(payload, null, 2),
      `chore(progress): ${steps[steps.length - 1]?.name || 'init'}`);
  } catch (e) { console.log('[progress] write failed:', e.message); }
}

async function step(name, fn, meta = {}) {
  const s = { name, status: 'running', at: new Date().toISOString(), ...meta };
  steps.push(s); await pushProgress();
  try {
    const result = await fn();
    s.status = 'done'; s.at = new Date().toISOString(); await pushProgress(); return result;
  } catch (e) {
    s.status = 'error'; s.error = String(e.message || e).slice(0, 300);
    s.at = new Date().toISOString(); throw e;
  }
}

/* ============================================================
   RULES + VALIDATOR
   ============================================================ */
const RULES = `Build a PURE VANILLA JAVASCRIPT single-page app.
STRICT RULES:
- ONE complete HTML file. Inline all CSS in <style>, all JS in <script>.
- NO frameworks: no React/Vue/Svelte/Angular/Alpine/jQuery/Bootstrap/Tailwind/Font Awesome.
- NO external URLs: no CDN scripts, no external fonts, no external images.
- NO import/export/require. NO fetch/XHR at runtime.
- Use ONLY: DOM APIs, CSS, localStorage, sessionStorage, Canvas, SVG, emoji.
- System fonts only (system-ui, Georgia, ui-monospace, Menlo).
- Always escape user input with textContent — never innerHTML for untrusted data.
- Add rel="noopener" to any target="_blank" link.
Reply with ONLY the complete HTML file, starting with <!DOCTYPE html> and ending with </html>. No other text.

`;

const FORBIDDEN = [
  /<script[^>]+src\s*=\s*["']https?:\/\//i, /<link[^>]+href\s*=\s*["']https?:\/\//i,
  /\breact\b/i, /\bvue\b/i, /\bsvelte\b/i, /\balpine\.?js\b/i, /\bhtmx\b/i, /\bjquery\b/i,
  /\bbootstrap\b/i, /\btailwind\b/i, /font-?awesome/i, /unpkg\.com/i, /cdn\.jsdelivr\.net/i,
  /cdnjs\.cloudflare\.com/i, /^\s*import\s+[\w{}\*\s,]+\s+from\s+["']/m, /\brequire\s*\(\s*["']/,
];

function isVanilla(html) {
  for (const re of FORBIDDEN) if (re.test(html)) return { ok: false, hit: String(re) };
  return { ok: true, hit: null };
}

function stripFences(t) {
  t = String(t || '').trim();
  // Remove markdown blocks
  t = t.replace(/^```(?:html|HTML)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  // Find the first <!DOCTYPE or <html
  const i = t.search(/<!DOCTYPE|<html/i);
  if (i > 0) t = t.slice(i);
  // Find the last </html>
  const j = t.lastIndexOf('</html>');
  if (j > 0) t = t.slice(0, j + 7);
  return t.trim();
}

function isUsable(html) {
  return /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html) && html.length > 500;
}

/* ============================================================
   AI PROVIDERS
   ============================================================ */
async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}
const SYS_PROMPT = 'You output raw HTML files only. Start with <!DOCTYPE html> and end with </html>. No markdown fences.';

/* 1. Hugging Face */
async function callHuggingFace(prompt) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error('HF_TOKEN secret is missing');
  const res = await withTimeout(fetch('https://api-inference.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      model: 'meta-llama/Meta-Llama-3-8B-Instruct',
      messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: prompt }],
      temperature: 0.5, max_tokens: 4000
    }),
  }), 120000, 'HuggingFace');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

/* 2. OpenRouter (specific coding model) */
async function callOpenRouter(prompt) {
  const token = process.env.OPENROUTER_API_KEY;
  if (!token) throw new Error('OPENROUTER_API_KEY secret is missing');
  const res = await withTimeout(fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'HTTP-Referer': 'https://suryasticsai.github.io/Ariotica/',
      'X-Title': 'Ariotica'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: prompt }],
    }),
  }), 120000, 'OpenRouter');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

/* 3. Pollinations GET */
async function callPollinationsGet(prompt) {
  const trimmed = prompt.length > 8000 ? prompt.slice(0, 8000) : prompt;
  const url = `${POLL_GET}/${encodeURIComponent(trimmed)}?model=openai&private=true&seed=${Date.now() % 100000}`;
  const res = await withTimeout(fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 Ariotica/1.0', 'Referer': 'https://suryasticsai.github.io/Ariotica/' },
  }), 120000, 'Pollinations-GET');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.length < 200) throw new Error('short response');
  return text;
}

/* 4. Pollinations POST */
async function callPollinationsPost(prompt) {
  const res = await withTimeout(fetch(POLL_POST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Referer': 'https://suryasticsai.github.io/Ariotica/' },
    body: JSON.stringify({
      model: 'openai',
      messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: prompt }],
    }),
  }), 120000, 'Pollinations-POST');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content || data.text || '';
}

async function askAI(prompt) {
  const providers = [
    ['HuggingFace', callHuggingFace],
    ['OpenRouter', callOpenRouter],
    ['Pollinations-GET', callPollinationsGet],
    ['Pollinations-POST', callPollinationsPost],
  ];
  const errors = [];
  for (const [name, fn] of providers) {
    for (let i = 1; i <= 2; i++) {
      try {
        console.log(`[${name}] attempt ${i}/2 ...`);
        steps.push({ name: `${name} · attempt ${i}`, status: 'running', at: new Date().toISOString() });
        await pushProgress();
        const text = await fn(prompt);
        steps[steps.length - 1].status = 'done';
        steps[steps.length - 1].at = new Date().toISOString();
        steps[steps.length - 1].chars = text.length;
        await pushProgress();
        return { text, provider: name };
      } catch (e) {
        const msg = String(e.message || e).slice(0, 220);
        errors.push(`${name} #${i}: ${msg}`);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].error = msg;
        steps[steps.length - 1].at = new Date().toISOString();
        await pushProgress();
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
function resolveInputs() {
  const dProj = (process.env.DISPATCH_PROJECT || '').trim();
  if (dProj) return { project: dProj, prompt: (process.env.DISPATCH_PROMPT || '').trim(), mode: (process.env.DISPATCH_MODE || 'create').toLowerCase(), issue: null };
  const title = process.env.ISSUE_TITLE || '', body = process.env.ISSUE_BODY || '', num = parseInt(process.env.ISSUE_NUMBER || '0', 10);
  const m = title.match(/^\[BUILD\]\s+([A-Za-z0-9 _-]+?)(?:\s*\[(improve|fix|audit|delete)\])?\s*$/);
  if (!m) throw new Error('Title must be: [BUILD] name [improve|fix|audit|delete]');
  return { project: m[1].trim(), prompt: body.trim(), mode: (m[2] || 'create').toLowerCase(), issue: num || null };
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
  let ctx = '\n\nREFERENCE APPS:\n'; const refs = [];
  for (const e of scored) { const f = await readFile(e.file); if (!f) continue; refs.push(e.project); ctx += `\n--- ${e.project} ---\n${f.slice(0, 2500)}\n`; }
  return { ctx, refs };
}

async function main() {
  await pushProgress({ status: 'running' });
  const { project, prompt, mode, issue } = await step('Parse issue', async () => resolveInputs());
  const slug = slugify(project);
  if (!slug) throw new Error('Project name needs at least one letter or digit');
  const filename = `${PROJECTS_DIR}/${slug}.html`;

  let manifest = []; try { const raw = await readFile(MANIFEST_PATH); if (raw) manifest = JSON.parse(raw); if (!Array.isArray(manifest)) manifest = []; } catch { manifest = []; }

  if (mode === 'delete') {
    let existed = await deleteFile(filename, `chore: delete ${slug}`) || await deleteFile(`${slug}.html`, `chore: delete legacy ${slug}`);
    manifest = manifest.filter(e => e.project !== slug);
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', `chore: manifest`);
    if (issue) { try { await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body: existed ? `🗑 Deleted \`${slug}\`.` : `Did not exist.` }); await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' }); } catch {} }
    await pushProgress({ status: 'done' }); return;
  }

  let existing = await readFile(filename); let legacyPath = null;
  if (!existing) { const legacy = await readFile(`${slug}.html`); if (legacy) { existing = legacy; legacyPath = `${slug}.html`; } }
  if ((mode === 'improve' || mode === 'fix' || mode === 'audit') && !existing) throw new Error(`Cannot ${mode} "${slug}": no existing file.`);

  let ask, initialFindings = null;
  if (mode === 'create' || (!existing && mode !== 'fix' && mode !== 'audit')) ask = existing ? 'Improve the existing app. Keep what works and apply: ' + prompt : prompt;
  else if (mode === 'improve') ask = 'Improve the existing app. Keep what works and apply: ' + prompt;
  else if (mode === 'fix') ask = `Fix ONLY the bug described.\n\nBUG: ${prompt}\n\nReturn the complete fixed HTML.`;
  else if (mode === 'audit') {
    initialFindings = await step('Initial security scan', () => runAllScanners(existing));
    if (!initialFindings.findings.length && !prompt) {
      if (issue) { try { await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body: `✅ Audit clean.` }); await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' }); } catch {} }
      await pushProgress({ status: 'done' }); return;
    }
    const report = initialFindings.findings.length ? initialFindings.findings.map(f => `- [${f.sev}] ${f.msg}`).join('\n') : '(none)';
    ask = `Fix the security issues.\n\nFINDINGS:\n${report}\n\nEXTRA: ${prompt || 'none'}\n\nReturn the complete fixed HTML.`;
  }

  const { ctx: ragCtx, refs } = await step('Build RAG context', () => (mode === 'create' || mode === 'improve') ? buildRagContext(prompt, manifest, slug) : Promise.resolve({ ctx: '', refs: [] }));
  let fullPrompt = RULES + ask + ragCtx; if (existing) fullPrompt += '\n\nCURRENT HTML:\n' + existing.slice(0, 14000);

  // First generation attempt
  const { text, provider } = await step('Generate with AI', () => askAI(fullPrompt), { promptChars: fullPrompt.length, ragRefs: refs.join(', ') || 'none' });
  
  let html = stripFences(text);
  
  // Retry if unusable (missing HTML tags or too short)
  if (!isUsable(html)) {
    currentDraft = html; await pushProgress();
    const strict = `Previous attempt did not return a valid complete HTML file. Ensure you output ONLY raw HTML starting with <!DOCTYPE html> and ending with </html>.\n\n` + fullPrompt;
    const r = await step('Retry (unusable HTML)', () => askAI(strict));
    html = stripFences(r.text); 
    if (!isUsable(html)) throw new Error(`Still unusable HTML`);
  }

  // Retry if non-vanilla (used external scripts)
  let check = isVanilla(html);
  if (!check.ok) {
    currentDraft = html; await pushProgress();
    const strict = `Previous attempt used a forbidden library (${check.hit}). Regenerate with ONLY vanilla JavaScript. No frameworks, no CDNs.\n\n` + fullPrompt;
    const r = await step('Retry (vanilla enforcement)', () => askAI(strict));
    html = stripFences(r.text); check = isVanilla(html); if (!check.ok) throw new Error(`Still non-vanilla`);
  }

  const security = await step('Security scan', () => runAllScanners(html));
  await step(`Commit ${filename}`, () => writeFile(filename, html, `feat: ${slug} (${mode})`));
  if (legacyPath && mode !== 'create') { try { await deleteFile(legacyPath, `chore: migrate`); } catch {} }

  const idx = manifest.findIndex(e => e.project === slug);
  const entry = { project: slug, file: filename, prompt: prompt.slice(0, 240), created: new Date().toISOString().slice(0, 19), mode, provider, findings: security.counts.total, size: html.length };
  if (idx === -1) manifest.push(entry); else manifest[idx] = Object.assign({}, manifest[idx], entry);
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', `chore: manifest`);

  if (issue) {
    const url = `https://${OWNER}.github.io/${REPO}/${filename}`;
    let body = `✅ **${mode}** complete: \`${filename}\` via **${provider}**\n\nLive in ~1 min: ${url}`;
    if (security.findings.length) body += `\n\n**Security findings:**\n` + security.findings.slice(0, 10).map(f => `- [${f.sev}] ${f.msg}`).join('\n');
    try { await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body }); await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' }); } catch {}
  }
  await pushProgress({ status: 'done', securitySummary: security.counts });
}

main().catch(async (err) => {
  console.error('ERROR:', err.message);
  currentError = String(err.message).slice(0, 1000);
  steps.push({ name: 'Error', status: 'error', error: currentError, at: new Date().toISOString() });
  await pushProgress({ status: 'error' });
  const num = parseInt(process.env.ISSUE_NUMBER || '0', 10);
  if (num && OWNER && REPO) { try { await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: num, body: `❌ Failed:\n\n\`\`\`\n${currentError.slice(0, 1500)}\n\`\`\`` }); } catch {} }
  process.exit(1);
});