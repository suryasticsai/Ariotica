'use strict';
const fs = require('fs');
const { Octokit } = require('@octokit/rest');
const T = require('./lib/text');
const Rag = require('./lib/rag');
const K = require('./lib/knowledge');
const R = require('./lib/receipt');
const { runAllScanners } = require('./lib/scan');
const { smokeTest } = require('./lib/smoke');
const { askAI } = require('./lib/providers');

const PROJECTS_DIR  = 'projects';
const RECEIPTS_DIR  = 'receipts';
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

const icon = (s) => (s.status === 'done' ? '✅' : s.status === 'error' ? '❌' : s.status === 'cancelled' ? '⏹️' : '⏳');
const stepLine = (s) => `${icon(s)} ${s.name}${s.sec != null ? ` — ${s.sec}s` : ''}${s.model ? ` (${s.model})` : ''}${s.note ? ` — ${s.note}` : ''}${s.error ? ` — ${String(s.error).slice(0, 100)}` : ''}`;
const elapsed = () => Math.round((Date.now() - T0) / 1000);

async function updateStatusComment(force) {
  if (!statusCommentId || statusDone) return;
  if (!force && Date.now() - lastStatus < STATUS_EVERY) return;
  lastStatus = Date.now();
  const lines = steps.filter((s) => s.name !== 'Error').slice(-12).map(stepLine);
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
  const rows = new Map();
  return async (e) => {
    const at = new Date().toISOString();
    if (e.type === 'start') { const s = { name: e.name, status: 'running', at }; rows.set(e.name, s); steps.push(s); }
    else {
      const s = rows.get(e.name);
      if (s && e.type === 'ok') Object.assign(s, { status: 'done', sec: e.sec, chars: e.chars, model: e.model, at });
      else if (s && e.type === 'fail') Object.assign(s, { status: 'error', sec: e.sec, chars: e.chars, model: e.model, error: e.error, at });
      else if (s && e.type === 'cancel') Object.assign(s, { status: 'cancelled', sec: e.sec, note: 'lost the race', at });
    }
    await pushProgress();
  };
}

const RULES = `You are a Senior UI/UX Engineer building a PURE VANILLA JAVASCRIPT web app using multiple files.
STRICT RULES:
- Create separate files: index.html, style.css, script.js.
- Link them properly using <link rel="stylesheet" href="style.css"> and <script src="script.js"></script>.
- NO frameworks, NO external URLs, NO import/export/require.
- **DESIGN SYSTEM**: You MUST use CSS variables (:root) for colors. Use a modern, sleek aesthetic. Use Flexbox/Grid. Use smooth transitions (0.3s ease) on all hover states and button clicks.
- **RESPONSIVE**: Must look perfect on mobile (375px) and desktop. Use media queries.
- **ACCESSIBILITY**: Use semantic HTML, aria-labels, and ensure high contrast.
- **UX**: Always include a clear empty state (e.g., "No tasks yet, add one!"). Handle edge cases gracefully.
- Use only: DOM APIs, CSS, localStorage, Canvas, SVG, emoji. System fonts only (system-ui, Georgia, monospace).
- The app must run without console errors on load and when every button is pressed once.

OUTPUT FORMAT: reply with ONLY one JSON object and nothing else.
{
  "files": {
    "index.html": "<!DOCTYPE html>...",
    "style.css": ":root { ... }",
    "script.js": "console.log('...');"
  },
  "version": "1.0.0",
  "features": ["List of new features added"],
  "fixes": ["List of bugs fixed"],
  "suggestions": ["Ideas for the next version"],
  "grade": "A+, A, B, etc",
  "percentile": "Top 5%",
  "humanInvolvement": "Explain what the human needs to do next",
  "libraries": ["List any external libraries used (None preferred)"]
}
`;

const GEN_SYSTEM = 'You reply with a single valid JSON object only. No markdown fences, no other text.';
const genMessages = (userText) => [{ role: 'system', content: GEN_SYSTEM }, { role: 'user', content: userText }];
const HINT = '\n\n💬 Reply with `[improve] …`, `[fix] …`, `[audit]`, `[delete]` — or `[ask] …` to ask me anything about this repo.';
const MENTIONS_SCAN = /\b(sonar|scan|scanner|lint|security|findings?|warnings?|issues?)\b/i;

async function gradeHtml(text) {
  const meta = T.parseMultiFileResponse(text);
  if (!meta || !meta.files || !meta.files['index.html']) {
    return { ok: false, score: 0, html: text, reason: 'invalid JSON or missing index.html' };
  }
  
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

  if (!T.isUsable(testHtml)) return { ok: false, score: 0, html: testHtml, reason: 'incomplete or malformed HTML' };
  const v = T.isVanilla(testHtml);
  if (!v.ok) return { ok: false, score: 10, html: testHtml, reason: `forbidden pattern ${v.hit}` };
  
  const smoke = await smokeTest(testHtml);
  const n = smoke.errors.length;
  return { ok: smoke.ok, score: 100 - 10 * Math.min(n, 9), html: testHtml, files: meta.files, meta, smoke, reason: smoke.ok ? '' : `${n} runtime error(s)` };
}

const structurallyBad = (c) => !c.grade.files || !c.grade.files['index.html'] || !T.isVanilla(c.grade.html).ok;
const generate = (userText) => askAI(genMessages(userText), { json: true, grade: gradeHtml, onEvent: aiEvents() });

function raceLine(report) {
  const rows = (report || []).filter((r) => r.provider).slice(-6)
    .map((r) => `${r.provider}${r.sec != null ? ` ${r.sec}s` : ''} ${r.reason === 'lost the race' ? '⏹️' : r.ok ? '✅' : '❌'}`);
  return rows.length > 1 ? rows.join(' · ') : '';
}

async function readFile(path) {
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH }); if (Array.isArray(data)) return null; return Buffer.from(data.content, 'base64').toString('utf8'); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

async function writeFile(path, content, message) {
  let sha = null;
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH }); if (!Array.isArray(data)) sha = data.sha; }
  catch (e) { if (e.status !== 404) throw e; }
  const res = await octokit.repos.createOrUpdateFileContents({ owner: OWNER, repo: REPO, path, message, content: Buffer.from(content, 'utf8').toString('base64'), branch: BRANCH, ...(sha ? { sha } : {}) });
  return res.data && res.data.commit && res.data.commit.sha;
}

async function deleteFile(path, message) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (Array.isArray(data)) return false;
    await octokit.repos.deleteFile({ owner: OWNER, repo: REPO, path, message, sha: data.sha, branch: BRANCH });
    return true;
  } catch (e) { if (e.status === 404) return false; throw e; }
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
    } catch (err) { }
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
  if (!inputs) { console.log('Comment has no [improve|fix|audit|delete|ask] tag - ignoring.'); return; }
  const { project, prompt, mode, issue, commentId } = inputs;
  currentIssue = issue;

  await pushProgress({ status: 'running' });
  await step('Parse request', async () => inputs);
  const slug = T.slugify(project);
  if (!slug) throw new Error('Project name needs at least one letter or digit');
  
  const baseDir = `${PROJECTS_DIR}/${slug}`;
  const mainFile = `${baseDir}/index.html`;
  const receiptPath = `${RECEIPTS_DIR}/${slug}.json`;

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
    let existed = false;
    for (const f of ['index.html', 'style.css', 'script.js', 'meta.json', 'receipt.json']) {
      const p = `${baseDir}/${f}`;
      const content = await readFile(p);
      if (content !== null) {
        try { await octokit.repos.deleteFile({ owner: OWNER, repo: REPO, path: p, message: `chore: delete ${slug}`, sha: (await octokit.repos.getContent({owner: OWNER, repo: REPO, path: p})).data.sha, branch: BRANCH }); existed = true; } catch {}
      }
    }
    try { await deleteFile(receiptPath, `chore: remove receipt ${slug}`); } catch { }
    manifest = manifest.filter((e) => e.project !== slug);
    const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(MANIFEST_PATH, manifestJson, 'chore: manifest');
    await softStep('Update knowledge index', () => updateKnowledgeIndex({ [MANIFEST_PATH]: manifestJson }, [receiptPath]));
    await finishStatus(issue, existed ? `🗑 Deleted \`${slug}\`.` : `\`${slug}\` did not exist.`, true);
    await pushProgress({ status: 'done' }); return;
  }

  let existingHtml = await readFile(mainFile);
  let existingCss = await readFile(`${baseDir}/style.css`) || '';
  let existingJs = await readFile(`${baseDir}/script.js`) || '';
  
  if ((mode === 'improve' || mode === 'fix' || mode === 'audit') && !existingHtml) throw new Error(`Cannot ${mode} "${slug}": no existing file.`);

  let ask;
  if (mode === 'create' || (!existingHtml && mode !== 'fix' && mode !== 'audit')) ask = prompt;
  else if (mode === 'improve') ask = 'Improve the existing app. Keep what works and apply: ' + prompt;
  else if (mode === 'fix') ask = `Fix ONLY the bug or issues described.\n\nBUG: ${prompt || 'see scanner findings'}`;
  else if (mode === 'audit') {
    let combined = existingHtml.replace('</head>', `<style>${existingCss}</style></head>`).replace('</body>', `<script>${existingJs}</script></body>`);
    const initial = await step('Initial security scan', () => runAllScanners(combined));
    if (!initial.findings.length && !prompt) {
      await finishStatus(issue, '✅ Audit clean — nothing to fix.', true);
      await pushProgress({ status: 'done' }); return;
    }
    const report = initial.findings.length ? initial.findings.map((f) => `- [${f.sev}] ${f.msg}`).join('\n') : '(none)';
    ask = `Fix the security issues.\n\nFINDINGS:\n${report}\n\nEXTRA: ${prompt || 'none'}`;
  }

  const { ctx: ragCtx, refs } = await step('Build RAG context', () => (mode === 'create' || mode === 'improve') ? buildRagContext(prompt, manifest, slug) : Promise.resolve({ ctx: '', refs: [] }));
  let fullPrompt = RULES + ask + ragCtx;
  if (existingHtml) {
    if (existingHtml.length > EXISTING_LIMIT) existingHtml = existingHtml.slice(0, EXISTING_LIMIT);
    fullPrompt += `\n\nCURRENT FILES:\n[index.html]:\n${existingHtml}\n\n[style.css]:\n${existingCss}\n\n[script.js]:\n${existingJs}`;
  }

  // 1) Race
  let cand = await step('Generate with AI (model race)', () => generate(fullPrompt), { promptChars: fullPrompt.length, ragRefs: refs.join(', ') || 'none' });
  let raceReport = cand.race.slice();

  if (structurallyBad(cand)) {
    currentDraft = cand.grade.html; await pushProgress({}, true);
    const v = T.isVanilla(cand.grade.html);
    const why = !T.isUsable(cand.grade.html)
      ? 'it was cut off or malformed. Reply with ONLY the JSON object {"files": {"index.html": "...", "style.css": "...", "script.js": "..."}}.'
      : `it used a forbidden library (matched ${v.hit}). Use ONLY vanilla JavaScript.`;
    cand = await step('Retry (rejected output)', () => generate(`Previous attempt was rejected: ${why}\n\n` + fullPrompt));
    raceReport = raceReport.concat(cand.race);
    if (structurallyBad(cand)) throw new Error(`Still rejected after retry (${cand.grade.reason || 'invalid output'}) from ${cand.provider}`);
  }

  let files = cand.grade.files;
  let testHtml = cand.grade.html;
  let smoke = cand.grade.smoke;
  let meta = cand.grade.meta;
  let provider = cand.provider; let model = cand.model;
  
  steps.push({ name: 'Smoke test', status: smoke.ok ? 'done' : 'error', at: new Date().toISOString(), note: 'ran during the model race', error: smoke.ok ? undefined : `${smoke.errors.length} runtime error(s)` });
  await pushProgress();

  // 2) 3-Step Self-Healing Loop
  let attempt = 1;
  while (!smoke.ok && attempt <= 3 && testHtml.length <= EXISTING_LIMIT) {
    const repairPrompt = `${RULES}Fix the runtime errors in this app. Keep everything else exactly as it is.\n\nRUNTIME ERRORS:\n${smoke.errors.map((e) => '- ' + e).join('\n')}\n\nCURRENT HTML:\n${testHtml}`;
    const baseline = cand.grade.score;
    
    const fixed = await softStep(`Repair attempt ${attempt}`, async () => {
      const r = await generate(repairPrompt);
      raceReport = raceReport.concat(r.race);
      if (structurallyBad(r) || r.grade.score <= baseline) throw new Error('repair did not improve the app; keeping the original');
      return r;
    });

    if (fixed) { 
      cand = fixed; files = fixed.grade.files; testHtml = fixed.grade.html; smoke = fixed.grade.smoke; meta = fixed.grade.meta; provider = fixed.provider; model = fixed.model; 
      if (smoke.ok) break;
    }
    attempt++;
  }

  // 3) Watermark & Meta
  if (files['index.html']) {
    const watermark = `\n<!-- Built by Ariotica AI -->\n<div style="position:fixed;bottom:12px;right:12px;opacity:0.35;font-size:11px;font-family:monospace;color:white;pointer-events:none;z-index:9999;">⚡ Ariotica</div>`;
    files['index.html'] = files['index.html'].replace(/<\/body>/i, `${watermark}\n</body>`);
  }

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
  files['meta.json'] = JSON.stringify(metaJson, null, 2);

  const security = await step('Security scan', () => runAllScanners(testHtml));
  
  const commitSha = await step(`Commit files to ${baseDir}/`, async () => {
    let lastSha;
    for (const [filename, content] of Object.entries(files)) {
      lastSha = await writeFile(`${baseDir}/${filename}`, content, `feat: ${slug} v${meta.version} (${mode})`);
    }
    return lastSha;
  });

  const receipt = R.buildReceipt({ repo: `${OWNER}/${REPO}`, slug, files, mode, runId: RUN_ID, commit: commitSha, provider, model, race: raceReport, smoke, security: security.counts, prompt, vanilla: T.isVanilla(testHtml) });
  const receiptJson = JSON.stringify(receipt, null, 2) + '\n';
  const receiptWritten = (await softStep('Write build receipt', async () => { await writeFile(receiptPath, receiptJson, `chore: receipt ${slug}`); return true; })) === true;

  const smokeLabel = smoke.skipped ? 'skipped' : smoke.ok ? 'pass' : `fail:${smoke.errors.length}`;
  const idx = manifest.findIndex((e) => e.project === slug);
  const entry = { 
    project: slug, file: mainFile, prompt: prompt.slice(0, 240), created: new Date().toISOString().slice(0, 19), mode, provider, model, 
    findings: security.counts.total, smoke: smokeLabel, size: Object.values(files).reduce((a, b) => a + b.length, 0),
    version: meta.version, features: meta.features, fixes: meta.fixes, suggestions: meta.suggestions,
    grade: meta.grade, percentile: meta.percentile, humanInvolvement: meta.humanInvolvement, libraries: meta.libraries,
    sha256: receipt.sha256, ...(receiptWritten ? { receipt: receiptPath } : {}) 
  };
  
  if (idx === -1) manifest.push(entry); else manifest[idx] = Object.assign({}, manifest[idx], entry);
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(MANIFEST_PATH, manifestJson, 'chore: manifest');
  await softStep('Update knowledge index', () => updateKnowledgeIndex(
    { [mainFile]: files['index.html'], [MANIFEST_PATH]: manifestJson, ...(receiptWritten ? { [receiptPath]: receiptJson } : {}) },
    []));

  const url = `https://${OWNER}.github.io/${REPO}/${baseDir}/`;
  let body = `✅ **${mode}** complete: \`${baseDir}/\` via **${provider}**${model ? ` (${model})` : ''}\n\nLive in ~1 min: ${url}`;
  const rl = raceLine(raceReport); if (rl) body += `\n\n🏁 Model race: ${rl}`;
  if (!smoke.skipped) body += smoke.ok ? '\n\n🧪 Smoke test: passed' : `\n\n🧪 Smoke test: ⚠️ ${smoke.errors.length} runtime issue(s) remain\n${smoke.errors.slice(0, 3).map((e) => '- ' + e).join('\n')}`;
  if (receiptWritten) body += `\n\n🧾 Receipt: [\`sha256:${receipt.sha256.slice(0, 12)}…\`](https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/${receiptPath}) · zero-deps ${receipt.checks.zeroDeps ? '✅' : '⚠️'} · verify with \`node verify-receipt.js ${slug}\``;
  
  if (meta.version) body += `\n\n**🏷️ Version:** \`v${meta.version}\``;
  if (meta.features.length) body += `\n\n**✨ New Features:**\n${meta.features.map(f => `- ${f}`).join('\n')}`;
  if (meta.fixes.length) body += `\n\n**🔧 Bugs Fixed:**\n${meta.fixes.map(f => `- ${f}`).join('\n')}`;
  if (security.findings.length) body += `\n\n**Scanner findings (${security.findings.length}):**\n` + security.findings.slice(0, 5).map((f) => `- [${f.sev}] ${f.msg}`).join('\n');

  await finishStatus(issue, body + HINT, true);
  await pushProgress({ status: 'done', securitySummary: security.counts, smoke: smokeLabel, sha256: receipt.sha256 });
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