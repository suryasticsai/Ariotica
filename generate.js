'use strict';
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const T = require('./lib/text');
const Rag = require('./lib/rag');
const K = require('./lib/knowledge');
const { runAllScanners } = require('./lib/scan');
const { smokeTest } = require('./lib/smoke');
const { askAI } = require('./lib/providers');

const PROJECTS_DIR  = 'projects';
const MANIFEST_PATH = 'projects.json';
const PROGRESS_PATH = 'progress.json';
const INDEX_PATH    = 'knowledge/index.json';

const EXISTING_LIMIT = 40000; 
const PROGRESS_EVERY = 20000;
const STATUS_EVERY   = 5000;

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const RUN_ID = process.env.RUN_ID || String(Date.now());
if (!OWNER || !REPO) { console.error('GITHUB_REPOSITORY not set'); process.exit(1); }

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

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

const icon = (s) => (s.status === 'done' ? '✅' : s.status === 'error' ? '❌' : '⏳');
const stepLine = (s) => `${icon(s)} ${s.name}${s.sec != null ? ` — ${s.sec}s` : ''}${s.model ? ` (${s.model})` : ''}${s.error ? ` — ${String(s.error).slice(0, 100)}` : ''}`;
const elapsed = () => Math.round((Date.now() - T0) / 1000);

async function updateStatusComment(force) {
  if (!statusCommentId || statusDone) return;
  if (!force && Date.now() - lastStatus < STATUS_EVERY) return;
  lastStatus = Date.now();
  const lines = steps.filter((s) => s.name !== 'Error').slice(-10).map(stepLine);
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

function writeJobSummary(extra) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  try { fs.appendFileSync(f, `## Ariotica run ${RUN_ID} (${elapsed()}s)\n\n${steps.map((s) => '- ' + stepLine(s)).join('\n')}\n\n${extra || ''}\n`); }
  catch { }
}

async function finishStatus(issue, body, close) {
  writeJobSummary(body);
  if (!issue) return;
  statusDone = true;
  const details = `<details><summary>Steps · ${elapsed()}s total</summary>\n\n${steps.filter((s) => s.name !== 'Error').map((s) => '- ' + stepLine(s)).join('\n')}\n\n</details>`;
  const watermark = `\n\n---\n*⚡ Built by [Ariotica AI](https://github.com/suryasticsai/Ariotica)*`;
  const full = `${body}\n\n${details}${watermark}`;
  
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
  try { await writeFile(PROGRESS_PATH, JSON.stringify(payload, null, 2), `chore(progress): ${steps[steps.length - 1]?.name || 'init'}`); }
  catch (e) { console.log('[progress] write failed:', e.message); }
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
    s.error = String(e.message || e).slice(0, 300); s.at = new Date().toISOString();
    await pushProgress({}, true); throw e;
  }
}

async function softStep(name, fn) {
  try { return await step(name, fn); } catch (e) { console.log(`[soft] ${name} failed: ${e.message}`); return null; }
}

function aiEvents() {
  let cur = null;
  return async (e) => {
    const at = new Date().toISOString();
    if (e.type === 'start') { cur = { name: e.name, status: 'running', at }; steps.push(cur); }
    else if (cur && e.type === 'ok') Object.assign(cur, { status: 'done', sec: e.sec, chars: e.chars, model: e.model, at });
    else if (cur && e.type === 'fail') Object.assign(cur, { status: 'error', sec: e.sec, error: e.error, at });
    await pushProgress();
  };
}

const RULES = `Build a PURE VANILLA JAVASCRIPT web app using multiple files.
STRICT RULES:
- Create separate files: index.html, style.css, script.js (or app.css/app.js).
- Link them properly using <link rel="stylesheet" href="style.css"> and <script src="script.js"></script>.
- NO frameworks or UI libraries of any kind.
- NO external URLs: no CDN scripts, no external fonts, no external images.
- Use ONLY: DOM APIs, CSS, localStorage, sessionStorage, Canvas, SVG, emoji.
- System fonts only (system-ui, Georgia, ui-monospace, Menlo).
- Always escape user input with textContent — never innerHTML for untrusted data.
- Add rel="noopener" to any target="_blank" link.
- The app must run without console errors on load and when every button is pressed once.

OUTPUT FORMAT: reply with ONLY one JSON object and nothing else.
{
  "version": "1.0.0",
  "files": {
    "index.html": "<!DOCTYPE html>...",
    "style.css": "body { ... }",
    "script.js": "console.log('...');"
  },
  "features": ["List of new features added"],
  "fixes": ["List of bugs fixed"],
  "suggestions": ["Ideas for the next version"],
  "grade": "A+, A, B, etc",
  "percentile": "Top 5%",
  "humanInvolvement": "Explain what the human needs to do next",
  "libraries": ["List any external libraries used (None preferred)"]
}
Escape double quotes as \\" and newlines as \\n so the JSON is valid. No markdown fences.
`;

const GEN_SYSTEM = 'You reply with a single valid JSON object only. No markdown fences, no other text.';
const genMessages = (userText) => [{ role: 'system', content: GEN_SYSTEM }, { role: 'user', content: userText }];

const HINT = '\n\n💬 Reply with `[improve] …`, `[fix] …`, `[audit]`, `[delete]` — or `[ask] …` to ask me anything about this repo.';
const MENTIONS_SCAN = /\b(sonar|scan|scanner|lint|security|findings?|warnings?|issues?)\b/i;

function parseMultiFileResponse(text) {
  let clean = String(text || '').trim();
  clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  try {
    const data = JSON.parse(clean.slice(start, end + 1));
    let files = data.files || {};
    if (data.html && !files['index.html']) files = { 'index.html': data.html };
    return {
      files: files,
      version: data.version || '1.0.0',
      features: Array.isArray(data.features) ? data.features : [],
      fixes: Array.isArray(data.fixes) ? data.fixes : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
      grade: data.grade || 'B',
      percentile: data.percentile || 'Top 50%',
      humanInvolvement: data.humanInvolvement || 'Low',
      libraries: Array.isArray(data.libraries) ? data.libraries : ['None']
    };
  } catch (e) {
    return null;
  }
}

async function readFile(p) {
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: p, ref: BRANCH }); if (Array.isArray(data)) return null; return Buffer.from(data.content, 'base64').toString('utf8'); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
async function writeFile(p, content, message) {
  let sha = null;
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: p, ref: BRANCH }); if (!Array.isArray(data)) sha = data.sha; }
  catch (e) { if (e.status !== 404) throw e; }
  await octokit.repos.createOrUpdateFileContents({ owner: OWNER, repo: REPO, path: p, message, content: Buffer.from(content, 'utf8').toString('base64'), branch: BRANCH, ...(sha ? { sha } : {}) });
}
async function deleteProjectFolder(slug) {
  const path = `${PROJECTS_DIR}/${slug}`;
  let existed = false;
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (Array.isArray(data)) {
      for (const file of data) {
        await octokit.repos.deleteFile({ owner: OWNER, repo: REPO, path: file.path, message: `chore: delete ${slug}`, sha: file.sha, branch: BRANCH });
        existed = true;
      }
    }
  } catch (e) { console.log('Delete folder err:', e.message); }
  return existed;
}

function resolveInputs() {
  const dProj = (process.env.DISPATCH_PROJECT || '').trim();
  if (dProj) return { project: dProj, prompt: (process.env.DISPATCH_PROMPT || '').trim(), mode: (process.env.DISPATCH_MODE || 'create').toLowerCase(), issue: null, commentId: null };

  const num = parseInt(process.env.ISSUE_NUMBER || '0', 10) || null;
  const tm = T.parseTitle(process.env.ISSUE_TITLE || '');
  if (!tm) throw new Error('Title must be: [BUILD] name [improve|fix|audit|delete]');

  if ((process.env.EVENT_NAME || '') === 'issue_comment') {
    const c = T.parseComment(process.env.COMMENT_BODY || '');
    if (!c) return null;
    return { project: tm.project, prompt: c.prompt, mode: c.mode, issue: num, commentId: parseInt(process.env.COMMENT_ID || '0', 10) || null };
  }
  const prompt = (process.env.ISSUE_BODY || '').trim();
  const mode = tm.mode || 'create';
  if (mode === 'create' && !prompt) throw new Error('Describe the app in the issue body.');
  return { project: tm.project, prompt, mode, issue: num, commentId: null };
}

function similarity(a, b) {
  const ta = new Set(Rag.tokenize(a)), tb = new Set(Rag.tokenize(b));
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const u = ta.size + tb.size - inter; return u === 0 ? 0 : inter / u;
}

async function buildRagContext(prompt, manifest, currentSlug) {
  if (!manifest || manifest.length < 2) return { ctx: '', refs: [] };
  const scored = manifest.filter((e) => e.project !== currentSlug)
    .map((e) => ({ ...e, score: similarity(prompt, e.prompt || '') }))
    .sort((a, b) => b.score - a.score).slice(0, 2).filter((e) => e.score > 0.15);
  if (!scored.length) return { ctx: '', refs: [] };
  
  let ctx = '\n\nREFERENCE APPS (style hints only):\n'; const refs = [];
  for (const e of scored) { 
    refs.push(e.project); 
    ctx += `\n--- ${e.project} ---\n`; 
    // Dynamically fetch all files from the reference project
    const dir = `${PROJECTS_DIR}/${e.project}`;
    try {
      const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: dir, ref: BRANCH });
      if (Array.isArray(data)) {
        for (const file of data) {
          if (file.type === 'file' && (file.name.endsWith('.html') || file.name.endsWith('.css') || file.name.endsWith('.js'))) {
            const content = await readFile(file.path);
            if (content) ctx += `[${file.name}]:\n${content.slice(0, 1500)}\n`;
          }
        }
      }
    } catch (err) { /* skip if folder doesn't exist */ }
  }
  return { ctx, refs };
}

async function updateKnowledgeIndex(overrides, removed) {
  const chunks = K.collectRepoChunks(process.cwd(), { overrides, removed })
    .concat(await K.collectIssueChunks(octokit, OWNER, REPO));
  await writeFile(INDEX_PATH, JSON.stringify(K.buildIndexObject(chunks)), 'chore: knowledge index');
  return chunks.length;
}

async function threadHistory(issue, skipIds) {
  try {
    const { data } = await octokit.issues.listComments({ owner: OWNER, repo: REPO, issue_number: issue, per_page: 40 });
    return data.filter((c) => !skipIds.includes(c.id)).slice(-8)
      .map((c) => ({ role: c.user && c.user.type === 'Bot' ? 'assistant' : 'user', content: K.cleanComment(c.body).slice(0, 1200) }))
      .filter((m) => m.content && !m.content.startsWith('⏳'));
  } catch { return []; }
}

function sourceLinks(hits) {
  const seen = new Set(); const out = [];
  for (const h of hits) {
    const c = h.chunk; const r = Rag.ref(c);
    if (seen.has(r)) continue; seen.add(r);
    const link = /^issue#\d+$/.test(c.path)
      ? `https://github.com/${OWNER}/${REPO}/issues/${c.path.slice(6)}`
      : `https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/${c.path}${c.start ? `#L${c.start}-L${c.end}` : ''}`;
    out.push(`- [\`${r}\`](${link})`);
  }
  return out.slice(0, 6).join('\n');
}

async function runAsk({ issue, prompt, commentId }) {
  if (!prompt) throw new Error('Add your question after [ask]');
  const chunks = await step('Index repo', async () => K.collectRepoChunks(process.cwd()).concat(await K.collectIssueChunks(octokit, OWNER, REPO)));
  const hits = Rag.createIndex(chunks).search(prompt, 6, { perFile: 2 });
  const history = await threadHistory(issue, [statusCommentId, commentId].filter(Boolean));

  const system = `You are Ariotica, the assistant for ${OWNER}/${REPO}. Answer using ONLY the CONTEXT. Cite sources like [path:start-end]. `;
  const messages = [{ role: 'system', content: system }, ...history,
    { role: 'user', content: `CONTEXT:\n${hits.length ? Rag.formatContext(hits, 9000) : '(nothing)'}\n\nQUESTION: ${prompt}` }];

  let body;
  try {
    const r = await step('Answer', () => askAI(messages, { maxTokens: 1200, onEvent: aiEvents() }));
    body = `${r.text.trim()}\n\n**Sources** (via ${r.provider})\n${sourceLinks(hits) || '_none_'}`;
  } catch (e) {
    body = `⚠️ No AI provider answered. Closest matches:\n${hits.slice(0, 3).map((h) => `- \`${Rag.ref(h.chunk)}\``).join('\n')}`;
  }
  await finishStatus(issue, body + HINT, false);
  await pushProgress({ status: 'done' });
}

async function main() {
  const inputs = resolveInputs();
  if (!inputs) { console.log('Comment has no valid tag - ignoring.'); return; }
  const { project, prompt, mode, issue, commentId } = inputs;
  currentIssue = issue;

  await pushProgress({ status: 'running' });
  await step('Parse request', async () => inputs);
  const slug = T.slugify(project);
  if (!slug) throw new Error('Project name needs at least one letter or digit');
  
  const baseDir = `${PROJECTS_DIR}/${slug}`;
  const mainFile = `${baseDir}/index.html`;

  if (commentId) {
    try { await octokit.reactions.createForIssueComment({ owner: OWNER, repo: REPO, comment_id: commentId, content: 'eyes' }); } catch (e) { }
    if (mode !== 'ask') { try { await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'open' }); } catch { } }
  }
  const quoted = prompt ? `\n> ${prompt.slice(0, 200).replace(/\n/g, ' ')}` : '';
  await startStatusComment(issue, mode === 'ask' ? `🔎 **Searching the repo…**${quoted}` : `⏳ **Working on it** — \`${mode}\` on \`${slug}\`${quoted}`);

  if (mode === 'ask') return runAsk(inputs);

  let manifest = [];
  try { const raw = await readFile(MANIFEST_PATH); if (raw) manifest = JSON.parse(raw); if (!Array.isArray(manifest)) manifest = []; } catch { manifest = []; }

  if (mode === 'delete') {
    const existed = await deleteProjectFolder(slug);
    manifest = manifest.filter((e) => e.project !== slug);
    const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(MANIFEST_PATH, manifestJson, 'chore: manifest');
    await softStep('Update knowledge index', () => updateKnowledgeIndex({ [MANIFEST_PATH]: manifestJson }, []));
    await finishStatus(issue, existed ? `🗑 Deleted \`${slug}\`.` : `\`${slug}\` did not exist.`, true);
    await pushProgress({ status: 'done' }); return;
  }

  // Load all existing files for RAG context
  let existingHtml = await readFile(mainFile);
  let existingCss = await readFile(`${baseDir}/style.css`) || await readFile(`${baseDir}/app.css`) || '';
  let existingJs = await readFile(`${baseDir}/script.js`) || await readFile(`${baseDir}/app.js`) || '';
  
  if ((mode === 'improve' || mode === 'fix' || mode === 'audit') && !existingHtml) throw new Error(`Cannot ${mode} "${slug}": no existing index.html.`);

  let ask;
  if (mode === 'create' || (!existingHtml && mode !== 'fix' && mode !== 'audit')) ask = prompt;
  else if (mode === 'improve') ask = 'Improve the existing app. Keep what works and apply: ' + prompt;
  else if (mode === 'fix') ask = `Fix ONLY the bug or issues described.\n\nBUG: ${prompt || 'see scanner findings'}`;
  else if (mode === 'audit') {
    let combined = existingHtml;
    if (existingCss) combined = combined.replace('</head>', `<style>${existingCss}</style></head>`);
    if (existingJs) combined = combined.replace('</body>', `<script>${existingJs}</script></body>`);
    const initial = await step('Initial security scan', () => runAllScanners(combined));
    if (!initial.findings.length && !prompt) {
      await finishStatus(issue, '✅ Audit clean — nothing to fix.', true);
      await pushProgress({ status: 'done' }); return;
    }
    const report = initial.findings.length ? initial.findings.map((f) => `- [${f.sev}] ${f.msg}`).join('\n') : '(none)';
    ask = `Fix the security issues.\n\nFINDINGS:\n${report}\n\nEXTRA: ${prompt || 'none'}`;
  }

  const { ctx: ragCtx, refs } = await step('Build RAG context', () => buildRagContext(prompt, manifest, slug));
  let fullPrompt = RULES + ask + ragCtx;
  if (existingHtml) {
    if (existingHtml.length > EXISTING_LIMIT) existingHtml = existingHtml.slice(0, EXISTING_LIMIT);
    fullPrompt += `\n\nCURRENT FILES:\n[index.html]:\n${existingHtml}\n\n[style.css]:\n${existingCss}\n\n[script.js]:\n${existingJs}`;
  }

  let { text, provider } = await step('Generate with AI', () => askAI(genMessages(fullPrompt), { json: true, onEvent: aiEvents() }), { promptChars: fullPrompt.length, ragRefs: refs.join(', ') || 'none' });
  
  let meta = parseMultiFileResponse(text);
  if (!meta) throw new Error(`Failed to parse AI response into JSON files.`);
  if (!meta.files['index.html']) throw new Error(`AI did not return an index.html file.`);

  // 1. Inject Watermark into HTML
  const watermark = `\n<!-- Built by Ariotica AI -->\n<div style="position:fixed;bottom:12px;right:12px;opacity:0.35;font-size:11px;font-family:monospace;color:white;pointer-events:none;z-index:9999;">⚡ Ariotica</div>`;
  meta.files['index.html'] = meta.files['index.html'].replace(/<\/body>/i, `${watermark}\n</body>`);

  // 2. Create separate meta.json (with watermark) to keep source files pristine
  const metaJson = {
    version: meta.version,
    features: meta.features,
    fixes: meta.fixes,
    suggestions: meta.suggestions,
    grade: meta.grade,
    percentile: meta.percentile,
    humanInvolvement: meta.humanInvolvement,
    libraries: meta.libraries,
    _watermark: "⚡ Built by Ariotica AI"
  };
  meta.files['meta.json'] = JSON.stringify(metaJson, null, 2);

  // 3. Dynamically build testHtml for Smoke Test & Scanner
  let testHtml = meta.files['index.html'];
  for (const [name, content] of Object.entries(meta.files)) {
    if (name.endsWith('.css')) {
      const regex = new RegExp(`<link[^>]*href=["'](?:\\.\\/)?${name}["'][^>]*>`, 'i');
      if (regex.test(testHtml)) testHtml = testHtml.replace(regex, `<style>\n${content}\n</style>`);
      else testHtml = testHtml.replace('</head>', `<style>\n${content}\n</style>\n</head>`);
    }
    if (name.endsWith('.js')) {
      const regex = new RegExp(`<script[^>]*src=["'](?:\\.\\/)?${name}["'][^>]*><\\/script>`, 'i');
      if (regex.test(testHtml)) testHtml = testHtml.replace(regex, `<script>\n${content}\n</script>`);
      else testHtml = testHtml.replace('</body>', `<script>\n${content}\n</script>\n</body>`);
    }
  }

  let check = T.isVanilla(testHtml);
  if (!check.ok) throw new Error(`AI used forbidden libraries (${check.hit})`);

  let smoke = await step('Smoke test', () => smokeTest(testHtml));
  const security = await step('Security scan', () => runAllScanners(testHtml));

  await step(`Commit files to ${baseDir}/`, async () => {
    for (const [filename, content] of Object.entries(meta.files)) {
      await writeFile(`${baseDir}/${filename}`, content, `feat: ${slug} v${meta.version} (${mode})`);
    }
  });

  const smokeLabel = smoke.skipped ? 'skipped' : smoke.ok ? 'pass' : `fail:${smoke.errors.length}`;
  const idx = manifest.findIndex((e) => e.project === slug);
  
  const entry = { 
    project: slug, file: mainFile, prompt: prompt.slice(0, 240), created: new Date().toISOString().slice(0, 19), mode, provider, 
    findings: security.counts.total, smoke: smokeLabel, size: Object.values(meta.files).reduce((a, b) => a + b.length, 0),
    version: meta.version, features: meta.features, fixes: meta.fixes, suggestions: meta.suggestions,
    grade: meta.grade, percentile: meta.percentile, humanInvolvement: meta.humanInvolvement, libraries: meta.libraries
  };
  
  if (idx === -1) manifest.push(entry); else manifest[idx] = Object.assign({}, manifest[idx], entry);
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(MANIFEST_PATH, manifestJson, 'chore: manifest');
  await softStep('Update knowledge index', () => updateKnowledgeIndex({ [mainFile]: meta.files['index.html'] || '' }, []));

  const url = `https://${OWNER}.github.io/${REPO}/${baseDir}/`;
  let body = `✅ **${mode}** complete: \`${baseDir}/\` via **${provider}**\n\nLive in ~1 min: ${url}\n\n`;
  
  if (meta.version) body += `**🏷️ Version:** \`v${meta.version}\`\n\n`;
  if (meta.features.length) body += `**✨ New Features Added:**\n${meta.features.map(f => `- ${f}`).join('\n')}\n\n`;
  if (meta.fixes.length) body += `**🔧 Bugs Fixed:**\n${meta.fixes.map(f => `- ${f}`).join('\n')}\n\n`;
  if (meta.suggestions.length) body += `**💡 Suggestions:**\n${meta.suggestions.map(f => `- ${f}`).join('\n')}\n\n`;
  
  if (meta.grade && meta.grade !== 'N/A') {
    body += `**🏆 Production Grade Rankings:**\n`;
    body += `- **Grade:** ${meta.grade} (${meta.percentile})\n`;
    body += `- **Human Involvement:** ${meta.humanInvolvement}\n`;
    body += `- **External Libraries:** ${meta.libraries.join(', ')}\n\n`;
  }

  if (!smoke.skipped) body += smoke.ok ? '🧪 **Smoke test:** passed\n\n' : `🧪 **Smoke test:** ⚠️ ${smoke.errors.length} issue(s)\n\n`;
  if (security.findings.length) body += `**🛡️ Scanner findings (${security.counts.total}):**\n` + security.findings.slice(0, 5).map((f) => `- [${f.sev}] ${f.msg}`).join('\n') + '\n\n';

  await finishStatus(issue, body + HINT, true);
  await pushProgress({ status: 'done', securitySummary: security.counts, smoke: smokeLabel });
}

main().catch(async (err) => {
  console.error('ERROR:', err.message);
  currentError = String(err.message).slice(0, 1000);
  steps.push({ name: 'Error', status: 'error', error: currentError, at: new Date().toISOString() });
  await pushProgress({ status: 'error' }, true);
  const num = currentIssue || parseInt(process.env.ISSUE_NUMBER || '0', 10);
  await finishStatus(num, `❌ **Failed**\n\n\`\`\`\n${currentError.slice(0, 1500)}\n\`\`\`${HINT}`, false);
  process.exit(1);
});