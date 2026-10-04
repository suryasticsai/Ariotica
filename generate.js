// generate.js — agent with live progress tracking and code streaming.
const { Octokit } = require('@octokit/rest');

const MANIFEST_PATH = 'projects.json';
const PROGRESS_PATH = 'progress.json';
const RAGINA_URL    = 'https://ragina-crawler-ragina.vercel.app/api/ask';
const POLL_GET      = 'https://text.pollinations.ai';
const POLL_POST     = 'https://text.pollinations.ai/openai';
const DDG_STATUS    = 'https://duckduckgo.com/duckchat/v1/status';
const DDG_CHAT      = 'https://duckduckgo.com/duckchat/v1/chat';

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
let started = new Date().toISOString();

async function pushProgress(update = {}) {
  const payload = {
    runId: RUN_ID,
    started,
    updated: new Date().toISOString(),
    status: currentError ? 'error' : (update.status || 'running'),
    steps,
    draft: currentDraft.slice(0, 8000), // cap for GitHub API size
    draftSize: currentDraft.length,
    error: currentError,
    ...update,
  };
  try {
    await writeFile(PROGRESS_PATH, JSON.stringify(payload, null, 2),
      `chore(progress): ${steps[steps.length - 1]?.name || 'init'}`);
    console.log(`[progress] ${payload.status} — ${steps[steps.length - 1]?.name || 'init'}`);
  } catch (e) {
    console.log('[progress] write failed:', e.message);
  }
}

async function step(name, fn, meta = {}) {
  const s = { name, status: 'running', at: new Date().toISOString(), ...meta };
  steps.push(s);
  await pushProgress();
  try {
    const result = await fn();
    s.status = 'done';
    s.at = new Date().toISOString();
    await pushProgress();
    return result;
  } catch (e) {
    s.status = 'error';
    s.error = String(e.message || e).slice(0, 300);
    s.at = new Date().toISOString();
    throw e;
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
Reply with ONLY the complete HTML file, starting with <!DOCTYPE html>.

`;

const FORBIDDEN = [
  /<script[^>]+src\s*=\s*["']https?:\/\//i,
  /<link[^>]+href\s*=\s*["']https?:\/\//i,
  /\breact\b/i, /\bvue\b/i, /\bsvelte\b/i, /\balpine\.?js\b/i,
  /\bhtmx\b/i, /\bjquery\b/i,
  /\bbootstrap\b/i, /\btailwind\b/i, /font-?awesome/i,
  /unpkg\.com/i, /cdn\.jsdelivr\.net/i, /cdnjs\.cloudflare\.com/i,
  /^\s*import\s+[\w{}\*\s,]+\s+from\s+["']/m,
  /\brequire\s*\(\s*["']/,
];

function isVanilla(html) {
  for (const re of FORBIDDEN) if (re.test(html)) return { ok: false, hit: String(re) };
  return { ok: true, hit: null };
}

function stripFences(t) {
  t = String(t || '').trim();
  t = t.replace(/^```(?:html|HTML)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  const i = t.search(/<!DOCTYPE|<html/i);
  if (i > 0) t = t.slice(i);
  return t.trim();
}

function isUsable(html) {
  return /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html) && html.length > 500;
}

/* ============================================================
   PROVIDERS — with streaming where possible
   ============================================================ */
async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out`)), ms);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

async function callPollinationsGet(prompt) {
  const trimmed = prompt.length > 8000 ? prompt.slice(0, 8000) : prompt;
  const url = `${POLL_GET}/${encodeURIComponent(trimmed)}?model=openai&private=true&seed=${Date.now() % 100000}`;
  const res = await withTimeout(fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Ariotica/1.0',
      'Referer': 'https://suryasticsai.github.io/Ariotica/',
    },
  }), 120000, 'Pollinations-GET');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.length < 200) throw new Error(`short (${text.length} chars)`);
  return text;
}

async function callPollinationsPost(prompt) {
  // Use streaming to update the draft live
  const res = await withTimeout(fetch(POLL_POST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Referer': 'https://suryasticsai.github.io/Ariotica/',
      'User-Agent': 'Mozilla/5.0 Ariotica/1.0',
    },
    body: JSON.stringify({
      model: 'openai',
      stream: true,
      messages: [
        { role: 'system', content: 'You output raw HTML only. Start with <!DOCTYPE html>. No markdown fences.' },
        { role: 'user', content: prompt },
      ],
    }),
  }), 180000, 'Pollinations-POST');

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream') || contentType.includes('stream')) {
    // SSE streaming
    let out = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastPush = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          const chunk = obj.choices?.[0]?.delta?.content || '';
          if (chunk) out += chunk;
        } catch {}
      }

      // Push progress every 4 seconds
      if (Date.now() - lastPush > 4000 && out.length > 0) {
        currentDraft = stripFences(out);
        await pushProgress();
        lastPush = Date.now();
      }
    }

    if (!out) throw new Error('empty stream');
    return out;
  } else {
    // Non-streaming JSON fallback
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || data.text || '';
    if (!text) throw new Error('empty response');
    return text;
  }
}

async function callRagina(prompt) {
  const res = await withTimeout(fetch(RAGINA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  }), 120000, 'RAGina');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data = await res.json();
  if (data.error) throw new Error(String(data.error).slice(0, 150));
  const text = data.text || data.response || data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('empty response');
  return text;
}

async function callDuckDuckGo(prompt) {
  const statusRes = await withTimeout(fetch(DDG_STATUS, {
    headers: { 'x-vqd-accept': '1', 'User-Agent': 'Mozilla/5.0' },
  }), 30000, 'DDG-status');
  const vqd = statusRes.headers.get('x-vqd-4');
  if (!vqd) throw new Error('no vqd token');

  const chatRes = await withTimeout(fetch(DDG_CHAT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-vqd-4': vqd,
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt.slice(0, 12000) }],
    }),
  }), 120000, 'DDG-chat');
  if (!chatRes.ok) throw new Error(`HTTP ${chatRes.status}`);

  const raw = await chatRes.text();
  let out = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      try { const o = JSON.parse(line.slice(6)); if (o.message) out += o.message; } catch {}
    }
  }
  if (!out) throw new Error('empty response');
  return out;
}

async function askAI(prompt) {
  const providers = [
    ['Pollinations-POST (streaming)', callPollinationsPost],
    ['Pollinations-GET', callPollinationsGet],
    ['RAGina', callRagina],
    ['DuckDuckGo', callDuckDuckGo],
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
   AUDIT
   ============================================================ */
function auditHtml(html) {
  const findings = [];
  if (/\.innerHTML\s*=\s*(?!['"`])/.test(html)) findings.push({ sev: 'high', type: 'xss', msg: 'innerHTML from variable' });
  if (/\beval\s*\(/.test(html) || /\bnew\s+Function\s*\(/.test(html)) findings.push({ sev: 'high', type: 'injection', msg: 'eval/Function' });
  if (/document\.write\s*\(/.test(html)) findings.push({ sev: 'medium', type: 'xss', msg: 'document.write' });
  const inline = html.match(/on\w+\s*=\s*["'][^"']*["']/gi) || [];
  const bad = inline.filter(h => /eval|Function|innerHTML/i.test(h));
  if (bad.length) findings.push({ sev: 'medium', type: 'xss', msg: `${bad.length} inline handler(s)` });
  const secretRe = [/(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, /sk-[A-Za-z0-9]{20,}/, /ghp_[A-Za-z0-9]{36}/];
  for (const re of secretRe) if (re.test(html)) { findings.push({ sev: 'high', type: 'secret', msg: 'hardcoded secret' }); break; }
  if (/<form[^>]+action\s*=\s*["']https?:\/\//i.test(html)) findings.push({ sev: 'medium', type: 'exfiltration', msg: 'external form action' });
  if (/<iframe[^>]+src\s*=\s*["']https?:\/\//i.test(html)) findings.push({ sev: 'low', type: 'embedding', msg: 'external iframe' });
  if (/target\s*=\s*["']_blank["'](?![^>]*rel\s*=\s*["'][^"']*noopener)/i.test(html)) findings.push({ sev: 'low', type: 'tabnabbing', msg: 'no rel=noopener' });
  return findings;
}

/* ============================================================
   OCTOKIT
   ============================================================ */
async function readFile(path) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (Array.isArray(data)) return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (e) { if (e.status === 404) return null; throw e; }
}

async function writeFile(path, content, message) {
  let sha = null;
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (!Array.isArray(data)) sha = data.sha;
  } catch (e) { if (e.status !== 404) throw e; }
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO, path, message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  });
}

async function deleteFile(path, message) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (Array.isArray(data)) return false;
    await octokit.repos.deleteFile({ owner: OWNER, repo: REPO, path, message, sha: data.sha, branch: BRANCH });
    return true;
  } catch (e) { if (e.status === 404) return false; throw e; }
}

/* ============================================================
   INPUTS
   ============================================================ */
function resolveInputs() {
  const dProj = (process.env.DISPATCH_PROJECT || '').trim();
  if (dProj) return {
    project: dProj,
    prompt: (process.env.DISPATCH_PROMPT || '').trim(),
    mode: (process.env.DISPATCH_MODE || 'create').toLowerCase(),
    issue: null,
  };
  const title = process.env.ISSUE_TITLE || '';
  const body = process.env.ISSUE_BODY || '';
  const num = parseInt(process.env.ISSUE_NUMBER || '0', 10);
  const m = title.match(/^\[BUILD\]\s+([A-Za-z0-9 _-]+?)(?:\s*\[(improve|fix|audit|delete)\])?\s*$/);
  if (!m) throw new Error('Title must be: [BUILD] name [improve|fix|audit|delete]');
  return { project: m[1].trim(), prompt: body.trim(), mode: (m[2] || 'create').toLowerCase(), issue: num || null };
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/* ============================================================
   RAG CONTEXT
   ============================================================ */
function tokenize(s) { return String(s || '').toLowerCase().match(/\w+/g) || []; }
function similarity(a, b) {
  const ta = new Set(tokenize(a)), tb = new Set(tokenize(b));
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function buildRagContext(prompt, manifest, currentSlug) {
  if (!manifest || manifest.length < 2) return { ctx: '', refs: [] };
  const scored = manifest
    .filter(e => e.project !== currentSlug)
    .map(e => ({ ...e, score: similarity(prompt, e.prompt || '') }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter(e => e.score > 0.15);
  if (!scored.length) return { ctx: '', refs: [] };
  let ctx = '\n\nREFERENCE APPS (reuse patterns and conventions):\n';
  const refs = [];
  for (const e of scored) {
    const file = await readFile(e.file);
    if (!file) continue;
    refs.push(e.project);
    ctx += `\n--- ${e.project} ---\n${file.slice(0, 2500)}\n`;
  }
  return { ctx, refs };
}

/* ============================================================
   MAIN
   ============================================================ */
async function main() {
  await pushProgress({ status: 'running' });

  const { project, prompt, mode, issue } = await step('Parse issue', async () => resolveInputs());
  const slug = slugify(project);
  if (!slug) throw new Error('Project name needs at least one letter or digit');
  const filename = `${slug}.html`;

  let manifest = [];
  try {
    const raw = await readFile(MANIFEST_PATH);
    if (raw) manifest = JSON.parse(raw);
    if (!Array.isArray(manifest)) manifest = [];
  } catch { manifest = []; }

  // Delete mode
  if (mode === 'delete') {
    const existed = await step('Delete file', () => deleteFile(filename, `chore: delete ${slug}`));
    manifest = manifest.filter(e => e.project !== slug);
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', `chore: manifest`);
    if (issue) {
      try {
        await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue,
          body: existed ? `🗑 Deleted \`${filename}\`.` : `Did not exist.` });
        await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' });
      } catch {}
    }
    await pushProgress({ status: 'done' });
    return;
  }

  const existing = await readFile(filename);
  if ((mode === 'improve' || mode === 'fix' || mode === 'audit') && !existing) {
    throw new Error(`Cannot ${mode} "${slug}": no existing file.`);
  }

  // Build prompt
  let ask, auditFindings = [];
  if (mode === 'create' || (!existing && mode !== 'fix' && mode !== 'audit')) {
    ask = existing ? 'Improve the existing app. Keep what works and apply: ' + prompt : prompt;
  } else if (mode === 'improve') {
    ask = 'Improve the existing app. Keep what works and apply: ' + prompt;
  } else if (mode === 'fix') {
    ask = `Fix ONLY the bug described.\n\nBUG: ${prompt}\n\nReturn the complete fixed HTML.`;
  } else if (mode === 'audit') {
    auditFindings = auditHtml(existing);
    if (!auditFindings.length && !prompt) {
      if (issue) {
        await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body: `✅ Audit clean.` });
        await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' });
      }
      await pushProgress({ status: 'done' });
      return;
    }
    const report = auditFindings.length ? auditFindings.map(f => `- [${f.sev}] ${f.type}: ${f.msg}`).join('\n') : '(none)';
    ask = `Fix security issues. Keep functionality.\n\nFINDINGS:\n${report}\n\nEXTRA: ${prompt || 'none'}`;
  }

  // RAG
  const { ctx: ragCtx, refs } = await step('Build RAG context', () =>
    (mode === 'create' || mode === 'improve') ? buildRagContext(prompt, manifest, slug) : Promise.resolve({ ctx: '', refs: [] })
  );

  let fullPrompt = RULES + ask + ragCtx;
  if (existing) fullPrompt += '\n\nCURRENT HTML:\n' + existing.slice(0, 14000);

  // Generate
  const { text, provider } = await step('Generate with AI',
    () => askAI(fullPrompt),
    { promptChars: fullPrompt.length, ragRefs: refs.join(', ') || 'none' }
  );

  let html = stripFences(text);
  if (!isUsable(html)) throw new Error(`${provider} returned unusable HTML`);

  // Validate
  let check = isVanilla(html);
  if (!check.ok) {
    currentDraft = html;
    await pushProgress();
    const strict = `Previous attempt used a forbidden library (${check.hit}). Regenerate with ONLY vanilla JavaScript.\n\n` + fullPrompt;
    const r = await step('Retry (vanilla enforcement)', () => askAI(strict));
    html = stripFences(r.text);
    check = isVanilla(html);
    if (!check.ok) throw new Error(`Still non-vanilla (${check.hit})`);
  }

  // Audit
  const postAudit = await step('Security scan', async () => auditHtml(html));

  // Commit
  await step('Commit file', () => writeFile(filename, html,
    `feat: ${slug} (${mode})${issue ? ` (issue #${issue})` : ''}`));

  // Manifest
  const idx = manifest.findIndex(e => e.project === slug);
  const entry = {
    project: slug, file: filename,
    prompt: prompt.slice(0, 240),
    created: new Date().toISOString().slice(0, 19),
    mode, provider, findings: postAudit.length, size: html.length,
  };
  if (idx === -1) manifest.push(entry);
  else manifest[idx] = Object.assign({}, manifest[idx], entry);
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', `chore: manifest for ${slug}`);

  if (issue) {
    const url = `https://${OWNER}.github.io/${REPO}/${filename}`;
    let body = `✅ **${mode}** complete: \`${filename}\` (${(html.length / 1024).toFixed(1)} KB) via **${provider}**\n\nLive in ~1 min: ${url}`;
    if (postAudit.length) body += `\n\n**Findings:**\n` + postAudit.map(f => `- [${f.sev}] ${f.msg}`).join('\n');
    try {
      await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body });
      await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' });
    } catch {}
  }

  await pushProgress({ status: 'done' });
}

main().catch(async (err) => {
  console.error('ERROR:', err.message);
  currentError = String(err.message).slice(0, 1000);
  steps.push({ name: 'Error', status: 'error', error: currentError, at: new Date().toISOString() });
  await pushProgress({ status: 'error' });

  const num = parseInt(process.env.ISSUE_NUMBER || '0', 10);
  if (num && OWNER && REPO) {
    try {
      await octokit.issues.createComment({
        owner: OWNER, repo: REPO, issue_number: num,
        body: `❌ Failed:\n\n\`\`\`\n${currentError.slice(0, 1500)}\n\`\`\``,
      });
    } catch {}
  }
  process.exit(1);
});