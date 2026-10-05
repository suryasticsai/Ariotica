// generate.js — agentic code generator with multi-scanner security audit.
// Providers: GitHub Models → api.airforce → OVHcloud → KeylessAI → Pollinations
// Scanners:  custom heuristics + ESLint + Sparrow SAST (+ SonarCloud via workflow)
// Files:     projects/<slug>.html
// Manifest:  projects.json (at repo root)
const { Octokit } = require('@octokit/rest');

const PROJECTS_DIR  = 'projects';
const MANIFEST_PATH = 'projects.json';
const PROGRESS_PATH = 'progress.json';
const POLL_POST     = 'https://text.pollinations.ai/openai';

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
    runId: RUN_ID,
    started,
    updated: new Date().toISOString(),
    status: currentError ? 'error' : (update.status || 'running'),
    steps,
    draft: currentDraft.slice(0, 8000),
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
- Add rel="noopener" to any target="_blank" link.
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
   AI PROVIDERS
   ============================================================ */
async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out`)), ms);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

const SYS_PROMPT = 'You output raw HTML files only. Start with <!DOCTYPE html>. No markdown fences.';

/* --- 1. GitHub Models (Azure-hosted endpoint — returns real JSON) --- */
async function callGitHubModels(prompt) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not available');
  const res = await withTimeout(fetch('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
    }),
  }), 120000, 'GitHubModels');
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { throw new Error(`Non-JSON response: ${raw.slice(0, 120)}`); }
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('empty response');
  return text;
}

/* --- 2. api.airforce (keyless community proxy) --- */
async function callAirforce(prompt) {
  const res = await withTimeout(fetch('https://api.airforce/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: prompt.slice(0, 12000) },
      ],
    }),
  }), 120000, 'airforce');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('empty response');
  return text;
}

/* --- 3. OVHcloud (keyless) --- */
async function callOVHCloud(prompt) {
  const models = ['Qwen3-Coder-30B-A3B-Instruct', 'gpt-oss-120b', 'Qwen3-32B'];
  let last;
  for (const model of models) {
    try {
      const res = await withTimeout(fetch('https://llm.endpoints.ai.cloud.ovh.net/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYS_PROMPT },
            { role: 'user', content: prompt.slice(0, 12000) },
          ],
        }),
      }), 90000, `OVH-${model}`);
      if (!res.ok) { last = new Error(`${model}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text) return text;
      last = new Error(`${model}: empty`);
    } catch (e) { last = e; }
  }
  throw last || new Error('all OVH models failed');
}

/* --- 4. KeylessAI --- */
async function callKeylessAI(prompt) {
  const res = await withTimeout(fetch('https://keylessai.thryx.workers.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: prompt.slice(0, 12000) },
      ],
    }),
  }), 120000, 'KeylessAI');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('empty response');
  return text;
}

/* --- 5. Pollinations --- */
async function callPollinations(prompt) {
  const res = await withTimeout(fetch(POLL_POST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Referer': 'https://suryasticsai.github.io/Ariotica/',
    },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  }), 120000, 'Pollinations');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || data.text || '';
  if (!text) throw new Error('empty response');
  return text;
}

async function askAI(prompt) {
  const providers = [
    ['GitHub Models', callGitHubModels],
    ['api.airforce',  callAirforce],
    ['OVHcloud',      callOVHCloud],
    ['KeylessAI',     callKeylessAI],
    ['Pollinations',  callPollinations],
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
  if (/\.innerHTML\s*=\s*(?!['"`])/.test(html))
    findings.push({ sev: 'high', type: 'custom', msg: 'innerHTML from variable — use textContent' });
  if (/\beval\s*\(/.test(html) || /\bnew\s+Function\s*\(/.test(html))
    findings.push({ sev: 'high', type: 'custom', msg: 'eval/Function constructor' });
  if (/document\.write\s*\(/.test(html))
    findings.push({ sev: 'medium', type: 'custom', msg: 'document.write() is unsafe' });
  const inline = html.match(/on\w+\s*=\s*["'][^"']*["']/gi) || [];
  const bad = inline.filter(h => /eval|Function|innerHTML/i.test(h));
  if (bad.length)
    findings.push({ sev: 'medium', type: 'custom', msg: `${bad.length} suspicious inline handler(s)` });
  const secretRe = [
    /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i,
    /sk-[A-Za-z0-9]{20,}/, /ghp_[A-Za-z0-9]{36}/,
  ];
  for (const re of secretRe) if (re.test(html)) {
    findings.push({ sev: 'high', type: 'custom', msg: 'possible hardcoded secret' }); break;
  }
  if (/<form[^>]+action\s*=\s*["']https?:\/\//i.test(html))
    findings.push({ sev: 'medium', type: 'custom', msg: 'external form action' });
  if (/<iframe[^>]+src\s*=\s*["']https?:\/\//i.test(html))
    findings.push({ sev: 'low', type: 'custom', msg: 'external iframe' });
  if (/target\s*=\s*["']_blank["'](?![^>]*rel\s*=\s*["'][^"']*noopener)/i.test(html))
    findings.push({ sev: 'low', type: 'custom', msg: 'no rel=noopener on target="_blank"' });
  return findings;
}

async function eslintAudit(html) {
  const findings = [];
  try {
    const { Linter } = require('eslint');
    const linter = new Linter();

    const scriptBlocks = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) scriptBlocks.push(m[1]);

    if (!scriptBlocks.length) return findings;

    const rules = {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-prototype-builtins': 'warn',
      'no-inner-declarations': 'warn',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unused-vars': 'warn',
      'no-undef': 'off',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-redeclare': 'error',
    };

    let idx = 0;
    for (const code of scriptBlocks) {
      idx++;
      const msgs = linter.verify(code, {
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'script',
          globals: {
            window: 'readonly', document: 'readonly', console: 'readonly',
            localStorage: 'readonly', sessionStorage: 'readonly',
            fetch: 'readonly', setTimeout: 'readonly', setInterval: 'readonly',
            clearTimeout: 'readonly', clearInterval: 'readonly',
            alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
            navigator: 'readonly', location: 'readonly', history: 'readonly',
            URL: 'readonly', Blob: 'readonly', FileReader: 'readonly',
            Image: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
            Node: 'readonly', Element: 'readonly', HTMLElement: 'readonly',
            requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
            MutationObserver: 'readonly', IntersectionObserver: 'readonly',
          },
        },
        rules,
      });
      for (const msg of msgs) {
        const sev = msg.severity === 2 ? 'high' : 'medium';
        findings.push({
          sev,
          type: 'eslint',
          msg: `[script#${idx}:${msg.line}:${msg.column}] ${msg.message} (${msg.ruleId})`,
        });
      }
    }
  } catch (e) {
    console.log('[eslint] failed:', e.message);
  }
  return findings;
}

async function sparrowAudit(html) {
  const findings = [];
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmp = path.join(os.tmpdir(), `ariotica-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, 'utf8');

    let scan;
    try {
      scan = require('sparrow-sast').scan;
    } catch (e) {
      console.log('[sparrow] package not installed, skipping');
      fs.unlinkSync(tmp);
      return findings;
    }

    const issues = await scan(tmp, {
      useBuiltinCheckers: true,
      languages: ['javascript', 'html'],
    });

    for (const issue of issues) {
      const severity = (issue.severity || '').toLowerCase();
      const sev =
        severity === 'critical' || severity === 'error' ? 'high' :
        severity === 'warning' ? 'medium' : 'low';
      findings.push({
        sev,
        type: 'sparrow',
        msg: `${issue.message}${issue.checker ? ` (${issue.checker})` : ''}`,
      });
    }

    fs.unlinkSync(tmp);
  } catch (e) {
    console.log('[sparrow] failed:', e.message);
  }
  return findings;
}

async function runAllScanners(html) {
  const results = { custom: [], eslint: [], sparrow: [] };

  results.custom = customAudit(html);

  try { results.eslint = await eslintAudit(html); }
  catch (e) { console.log('eslint scan error:', e.message); }

  try { results.sparrow = await sparrowAudit(html); }
  catch (e) { console.log('sparrow scan error:', e.message); }

  const all = [...results.custom, ...results.eslint, ...results.sparrow];

  const seen = new Set();
  const deduped = [];
  for (const f of all) {
    const key = f.type + ':' + f.msg.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  return {
    findings: deduped,
    counts: {
      total: deduped.length,
      high:   deduped.filter(f => f.sev === 'high').length,
      medium: deduped.filter(f => f.sev === 'medium').length,
      low:    deduped.filter(f => f.sev === 'low').length,
      byTool: {
        custom:  results.custom.length,
        eslint:  results.eslint.length,
        sparrow: results.sparrow.length,
      },
    },
  };
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
  const body  = process.env.ISSUE_BODY  || '';
  const num   = parseInt(process.env.ISSUE_NUMBER || '0', 10);
  const m = title.match(/^\[BUILD\]\s+([A-Za-z0-9 _-]+?)(?:\s*\[(improve|fix|audit|delete)\])?\s*$/);
  if (!m) throw new Error('Title must be: [BUILD] name [improve|fix|audit|delete]');
  return {
    project: m[1].trim(),
    prompt: body.trim(),
    mode: (m[2] || 'create').toLowerCase(),
    issue: num || null,
  };
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
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
    await octokit.repos.deleteFile({
      owner: OWNER, repo: REPO, path, message, sha: data.sha, branch: BRANCH,
    });
    return true;
  } catch (e) { if (e.status === 404) return false; throw e; }
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

  const filename = `${PROJECTS_DIR}/${slug}.html`;

  let manifest = [];
  try {
    const raw = await readFile(MANIFEST_PATH);
    if (raw) manifest = JSON.parse(raw);
    if (!Array.isArray(manifest)) manifest = [];
  } catch { manifest = []; }

  if (mode === 'delete') {
    let existed = await deleteFile(filename, `chore: delete ${slug}`);
    if (!existed) {
      existed = await deleteFile(`${slug}.html`, `chore: delete legacy ${slug}`);
    }
    manifest = manifest.filter(e => e.project !== slug);
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', `chore: manifest`);
    if (issue) {
      try {
        await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue,
          body: existed ? `🗑 Deleted \`${slug}\`.` : `Did not exist.` });
        await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' });
      } catch {}
    }
    await pushProgress({ status: 'done' });
    return;
  }

  let existing = await readFile(filename);
  let legacyPath = null;
  if (!existing) {
    const legacy = await readFile(`${slug}.html`);
    if (legacy) {
      console.log(`Found legacy file at root: ${slug}.html — will migrate to ${filename}`);
      existing = legacy;
      legacyPath = `${slug}.html`;
    }
  }

  if ((mode === 'improve' || mode === 'fix' || mode === 'audit') && !existing) {
    throw new Error(`Cannot ${mode} "${slug}": no existing file.`);
  }

  let ask, initialFindings = null;

  if (mode === 'create' || (!existing && mode !== 'fix' && mode !== 'audit')) {
    ask = existing ? 'Improve the existing app. Keep what works and apply: ' + prompt : prompt;
  } else if (mode === 'improve') {
    ask = 'Improve the existing app. Keep what works and apply: ' + prompt;
  } else if (mode === 'fix') {
    ask = `Fix ONLY the bug described.\n\nBUG: ${prompt}\n\nReturn the complete fixed HTML.`;
  } else if (mode === 'audit') {
    initialFindings = await step('Initial security scan', () => runAllScanners(existing));
    if (!initialFindings.findings.length && !prompt) {
      if (issue) {
        await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue,
          body: `✅ Audit clean — 0 findings across all scanners.` });
        await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' });
      }
      await pushProgress({ status: 'done' });
      return;
    }
    const report = initialFindings.findings.length
      ? initialFindings.findings.map(f => `- [${f.sev}] [${f.type}] ${f.msg}`).join('\n')
      : '(none)';
    ask = `Fix the security issues below. Keep functionality intact.\n\nFINDINGS:\n${report}\n\nEXTRA: ${prompt || 'none'}\n\nReturn the complete fixed HTML.`;
  }

  const { ctx: ragCtx, refs } = await step('Build RAG context', () =>
    (mode === 'create' || mode === 'improve')
      ? buildRagContext(prompt, manifest, slug)
      : Promise.resolve({ ctx: '', refs: [] })
  );

  let fullPrompt = RULES + ask + ragCtx;
  if (existing) fullPrompt += '\n\nCURRENT HTML:\n' + existing.slice(0, 14000);

  const { text, provider } = await step('Generate with AI',
    () => askAI(fullPrompt),
    { promptChars: fullPrompt.length, ragRefs: refs.join(', ') || 'none' }
  );

  let html = stripFences(text);
  if (!isUsable(html)) throw new Error(`${provider} returned unusable HTML`);

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

  const security = await step('Security scan (ESLint + Sparrow + heuristics)',
    () => runAllScanners(html),
    { scanners: 'custom + eslint + sparrow' }
  );

  console.log(`Security: ${security.counts.total} total — ${security.counts.high} high, ${security.counts.medium} medium, ${security.counts.low} low`);

  await step(`Commit ${filename}`, () => writeFile(filename, html,
    `feat: ${slug} (${mode})${issue ? ` (issue #${issue})` : ''}`));

  if (legacyPath && mode !== 'create') {
    try {
      await deleteFile(legacyPath, `chore: migrate ${slug} to ${PROJECTS_DIR}/`);
      console.log(`Migrated ${legacyPath} → ${filename}`);
    } catch (e) {
      console.log('legacy delete failed (non-fatal):', e.message);
    }
  }

  const idx = manifest.findIndex(e => e.project === slug);
  const entry = {
    project: slug,
    file: filename,
    prompt: prompt.slice(0, 240),
    created: new Date().toISOString().slice(0, 19),
    mode,
    provider,
    findings: security.counts.total,
    findingsHigh:   security.counts.high,
    findingsMedium: security.counts.medium,
    findingsLow:    security.counts.low,
    scanByTool: security.counts.byTool,
    size: html.length,
  };
  if (idx === -1) manifest.push(entry);
  else manifest[idx] = Object.assign({}, manifest[idx], entry);
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', `chore: manifest for ${slug}`);

  if (issue) {
    const url = `https://${OWNER}.github.io/${REPO}/${filename}`;
    let body = `✅ **${mode}** complete: \`${filename}\` (${(html.length / 1024).toFixed(1)} KB) via **${provider}**\n\n`;
    body += `**Live in ~1 min:** ${url}\n\n`;
    body += `### 🛡 Security scan\n`;
    body += `- **${security.counts.total}** findings total — ${security.counts.high}🔴 ${security.counts.medium}🟡 ${security.counts.low}🟢\n`;
    body += `- Custom: ${security.counts.byTool.custom} · ESLint: ${security.counts.byTool.eslint} · Sparrow: ${security.counts.byTool.sparrow}\n`;
    if (security.findings.length) {
      body += `\n**Top findings:**\n` + security.findings.slice(0, 10).map(f => `- [${f.sev}] \`${f.type}\` ${f.msg}`).join('\n');
    }
    try {
      await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body });
      await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' });
    } catch (e) { console.log('Issue ops failed:', e.message); }
  }

  await pushProgress({ status: 'done', securitySummary: security.counts });
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