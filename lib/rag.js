'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
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

const EXISTING_LIMIT = 30000;
const CSS_JS_LIMIT = 15000;
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
let lastStatus = 0;
const started = new Date().toISOString();

const icon = (s) => (s.status === 'done' ? '✅' : s.status === 'error' ? '❌' : s.status === 'cancelled' ? '⏹️' : '⏳');
const stepLine = (s) => `${icon(s)} ${s.name}${s.sec != null ? ` — ${s.sec}s` : ''}${s.model ? ` (${s.model})` : ''}${s.note ? ` — ${s.note}` : ''}${s.error ? ` — ${String(s.error).slice(0, 100)}` : ''}`;
const elapsed = () => Math.round((Date.now() - T0) / 1000);

function raceLine(report) {
  const rows = (report || []).filter((r) => r.provider).slice(-6)
    .map((r) => `${r.provider}${r.sec != null ? ` ${r.sec}s` : ''} ${r.reason === 'lost the race' ? '⏹️' : r.ok ? '✅' : '❌'}`);
  return rows.length > 1 ? rows.join(' · ') : '';
}

// Polls the GitHub API until the Pages deployment finishes
async function waitForPagesBuild(commitTime) {
  console.log('[pages] waiting for deployment...');
  for (let i = 0; i < 30; i++) { // up to 2.5 minutes
    try {
      const { data } = await octokit.repos.getPagesBuild({ owner: OWNER, repo: REPO });
      if (data.status === 'built' && new Date(data.updated_at).getTime() >= commitTime) {
        console.log('[pages] deployment successful');
        return true;
      }
    } catch (e) {
      if (e.status === 404) {
        console.log('[pages] GitHub Pages not configured, skipping wait.');
        return false;
      }
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('[pages] timeout waiting for deployment');
  return false;
}

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
- **STORAGE NAMESPACING**: If you use localStorage, ALL keys MUST be prefixed with the app's name (e.g., "kanban_items" not "items").
- Use only: DOM APIs, CSS, localStorage, Canvas, SVG, emoji. System fonts only.
- The app must run without console errors on load and when every button is pressed once.

OUTPUT FORMAT: reply with ONLY one JSON object and nothing else.
{
  "files": {
    "index.html": "<!DOCTYPE html>...",
    "style.css": ":root { ... }",
    "script.js": "console.log('...');"
  },
  "features": ["List of new features added"],
  "fixes": ["List of bugs fixed"],
  "suggestions": ["Ideas for the next version"],
  "humanInvolvement": "Explain what the human needs to do next",
  "libraries": ["List any external libraries used (None preferred)"]
}
`;

const SKILL_RULES = `You are an expert technical author.
Write a dense, 500-word markdown cheatsheet on how to implement the requested skill in vanilla JavaScript.
Include short, copy-pasteable code snippets. Focus on best practices.
Reply with ONLY the raw markdown text. No JSON. No conversational filler.`;

const GEN_SYSTEM = 'You reply with a single valid JSON object only. No markdown fences, no other text.';
const genMessages = (userText) => [{ role: 'system', content: GEN_SYSTEM }, { role: 'user', content: userText }];
const HINT = '\n\n💬 Reply with `[improve] …`, `[fix] …`, `[audit]`, `[delete]`, `[ask] …`, `[skill] …`, `[inspire] …`, or `[evolve] <file> …`.';

// ============================================================
// PATCH 1: array normalization lives at the top of gradeHtml
// ============================================================
async function gradeHtml(text) {
  const meta = T.parseMultiFileResponse(text);
  if (!meta || !meta.files || !meta.files['index.html']) {
    return { ok: false, score: 0, html: text, reason: 'invalid JSON or missing index.html' };
  }

  // Defensive: models occasionally emit arrays instead of strings for file bodies.
  // Coerce to strings before anything downstream touches them.
  for (const [k, v] of Object.entries(meta.files)) {
    if (typeof v !== 'string') {
      meta.files[k] = Array.isArray(v) ? v.join('\n') : String(v);
    }
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

async function readFile(path) {
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH }); if (Array.isArray(data)) return null; return Buffer.from(data.content, 'base64').toString('utf8'); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

async function atomicCommit(files, deletedPaths, message) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data: refData } = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}` });
      const latestCommitSha = refData.object.sha;
      const { data: commitData } = await octokit.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: latestCommitSha });

      const treeItems = [];
      for (const [path, content] of Object.entries(files)) {
        const { data: blob } = await octokit.git.createBlob({ owner: OWNER, repo: REPO, content, encoding: 'utf-8' });
        treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      // Deletions: sha: null removes the path from the resulting tree
      for (const path of (deletedPaths || [])) {
        treeItems.push({ path, mode: '100644', type: 'blob', sha: null });
      }

      const { data: newTree } = await octokit.git.createTree({
        owner: OWNER, repo: REPO,
        base_tree: commitData.tree.sha,
        tree: treeItems,
      });

      const { data: newCommit } = await octokit.git.createCommit({
        owner: OWNER, repo: REPO, message,
        tree: newTree.sha, parents: [latestCommitSha],
      });

      await octokit.git.updateRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}`, sha: newCommit.sha });
      return newCommit.sha;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// Refresh the runner's working tree so downstream steps (build-index.js,
// artifact upload, `git rev-parse HEAD`) see what generate.js just pushed.
async function syncCheckout() {
  try {
    execSync(`git fetch origin ${BRANCH} --quiet`, { stdio: 'pipe' });
    execSync(`git reset --hard -q origin/${BRANCH}`, { stdio: 'pipe' });
    console.log(`[sync] checkout → origin/${BRANCH}`);
  } catch (e) {
    console.log('[sync] non-fatal:', e.message);
  }
}

// ============================================================
// PATCH 3: GitHub search q must be ≤ 256 chars
// ============================================================
async function searchGitHubForInspiration(query) {
  // GitHub search rejects q > 256 chars; keep a little headroom
  const safeQuery = String(query).slice(0, 180).replace(/["\\\r\n]/g, ' ').trim();
  if (!safeQuery) return { inspiration: '', count: 0 };
  try {
    const { data } = await octokit.search.repos({
      q: `${safeQuery} language:html stars:>100`,
      sort: 'stars',
      order: 'desc',
      per_page: 3
    });

    let inspiration = '';
    for (const repo of data.items) {
      try {
        const { data: fileData } = await octokit.repos.getContent({
          owner: repo.owner.login,
          repo: repo.name,
          path: 'index.html'
        });
        if (fileData && fileData.content) {
          const content = Buffer.from(fileData.content, 'base64').toString('utf8');
          inspiration += `\n--- INSPIRATION FROM: ${repo.full_name} (⭐ ${repo.stargazers_count}) ---\n`;
          inspiration += content.slice(0, 2500) + '\n\n';
        }
      } catch (e) { }
    }
    return { inspiration, count: data.items.length };
  } catch (e) {
    console.log('Search failed:', e.message);
    return { inspiration: '', count: 0 };
  }
}

// ============================================================
// [ask] MODE — BM25 over repo + issue history (via lib/rag.js)
// ============================================================
function searchChunks(chunks, query, k) {
  // lib/rag.js exposes createIndex(chunks) -> { size, search(query, k, opts) }
  // search() returns [{ chunk, score }] — exactly what runAsk renders.
  try {
    const idx = Rag.createIndex(chunks);
    return idx.search(query, k || 6);
  } catch (e) {
    // If the indexer ever throws (malformed chunk), degrade to substring
    // rather than failing the whole [ask] command.
    console.log('[ask] BM25 index failed, falling back to substring:', e.message);
    const q = query.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!q) return [];
    return chunks
      .map((chunk) => {
        const matches = chunk.text.toLowerCase().match(new RegExp(q, 'g')) || [];
        return { chunk, score: matches.length };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k || 6);
  }
}

async function runAsk(inputs) {
  const { prompt, issue } = inputs;
  const query = (prompt || '').trim();
  if (!query) throw new Error('Usage: `[ask] <question>` — e.g. `[ask] how does the receipt hash work?`');

  const result = await step('Search repo + issues (BM25)', async () => {
    const repoChunks = K.collectRepoChunks(process.cwd(), {});
    const issueChunks = await K.collectIssueChunks(octokit, OWNER, REPO, 40);
    const chunks = repoChunks.concat(issueChunks);
    if (!chunks.length) throw new Error('No knowledge chunks available — is knowledge/index.json built?');
    const hits = searchChunks(chunks, query, 6);
    return { chunks, hits };
  });

  const lines = [`🔎 **Answer for:** ${query}`, ''];
  if (!result.hits.length) {
    lines.push('_No matches found in repo or issue history._');
  } else {
    result.hits.forEach((h, i) => {
      const snippet = h.chunk.text.slice(0, 400).replace(/\n+/g, ' ').trim();
      lines.push(`**${i + 1}. \`${h.chunk.path}\`** · score ${Number(h.score).toFixed(2)}`);
      lines.push(`> ${snippet}${h.chunk.text.length > 400 ? '…' : ''}`);
      lines.push('');
    });
    lines.push(`_${result.hits.length} of ${result.chunks.length} chunks shown._`);
  }

  await finishStatus(issue, lines.join('\n'), true);
  await pushProgress({ status: 'done' });
}

// ============================================================
// Input resolution
// ============================================================
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

async function main() {
  const inputs = resolveInputs();
  if (!inputs) { console.log('Comment has no valid tag - ignoring.'); return; }
  const { project, prompt, mode, issue, commentId } = inputs;
  currentIssue = issue;

  await pushProgress({ status: 'running' });
  await step('Parse request', async () => inputs);
  const slug = T.slugify(project);
  if (!slug && mode !== 'evolve') throw new Error('Project name needs at least one letter or digit');

  const baseDir = `${PROJECTS_DIR}/${slug}`;
  const mainFile = `${baseDir}/index.html`;
  const receiptPath = `${RECEIPTS_DIR}/${slug}.json`;

  if (commentId) {
    try { await octokit.reactions.createForIssueComment({ owner: OWNER, repo: REPO, comment_id: commentId, content: 'eyes' }); } catch (e) { }
    if (mode !== 'ask' && mode !== 'skill' && mode !== 'evolve') { try { await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'open' }); } catch { } }
  }
  const quoted = prompt ? `\n> ${prompt.slice(0, 200).replace(/\n/g, ' ')}` : '';
  await startStatusComment(issue, mode === 'ask' ? `🔎 **Searching the repo…**${quoted}` : `⏳ **Working on it** — \`${mode}\` on \`${slug || 'system'}\`${quoted}`);

  if (mode === 'ask') return runAsk(inputs);

  if (mode === 'skill') {
    const skillName = prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const r = await step('Generate Skill Cheatsheet', () => askAI([{ role: 'system', content: SKILL_RULES }, { role: 'user', content: prompt }]));
    const filePath = `knowledge/skills/${skillName}.md`;
    await atomicCommit({ [filePath]: r.text }, [], `docs: add skill ${skillName}`);
    await syncCheckout();
    await finishStatus(issue, `🧠 **Skill Learned:** I have written a cheatsheet for **${skillName}** and saved it to \`${filePath}\`. I will automatically use this knowledge in future builds!`, true);
    await pushProgress({ status: 'done' });
    return;
  }

  // --- THE DARWIN PROTOCOL (EVOLVE) ---
  if (mode === 'evolve') {
    const parts = prompt.split(' ');
    const targetFile = parts[0];
    const instructions = parts.slice(1).join(' ');

    if (!targetFile || !targetFile.includes('.')) {
      throw new Error('Usage: [evolve] <filename> <instructions>. e.g. [evolve] lib/providers.js Add a cache.');
    }

    const original = await readFile(targetFile);
    if (!original) throw new Error(`Target file not found in repo: ${targetFile}`);

    const evolvePrompt = `You are modifying the source code of an autonomous AI agent (Ariotica).
Here is the current content of '${targetFile}':
\`\`\`javascript
${original}
\`\`\`

INSTRUCTIONS:
${instructions}

Return ONLY the complete, modified file content. No markdown formatting, no conversational text. Keep all existing functionality intact.`;

    const r = await step(`Evolve ${targetFile}`, () => askAI([{ role: 'user', content: evolvePrompt }], { maxTokens: 8000 }));
    let newCode = r.text.trim();
    newCode = newCode.replace(/^```(?:javascript|js)?\s*\n?/, '').replace(/\n?```\s*$/, '');

    // CRITICAL SAFETY: Syntax Validation
    await step('Validate JavaScript Syntax', async () => {
      const tempFile = `/tmp/evolve-${Date.now()}.js`;
      fs.writeFileSync(tempFile, newCode);
      try {
        execSync(`node -c ${tempFile}`);
      } catch (e) {
        throw new Error(`AI generated invalid JavaScript syntax. Blocked commit. Error: ${e.stderr.toString().slice(0, 500)}`);
      }
    });

    await step(`Commit ${targetFile}`, () => atomicCommit({ [targetFile]: newCode }, [], `feat(evolve): modify ${targetFile}`));
    await syncCheckout();

    await finishStatus(issue, `🧬 **Evolution Successful.**\n\nI have modified \`${targetFile}\` based on your instructions. The new syntax was validated, and the changes have been committed to \`main\`.\n\n**Next step:** The next time you run a build, the agent will use its new capabilities.`, true);
    await pushProgress({ status: 'done' });
    return;
  }
  // ------------------------------------

  let manifest = [];
  try { const raw = await readFile(MANIFEST_PATH); if (raw) manifest = JSON.parse(raw); if (!Array.isArray(manifest)) manifest = []; } catch { manifest = []; }

  if (mode === 'delete') {
    // Collect every file we own for this project (including PWA assets)
    const filesToDelete = [];
    for (const f of ['index.html', 'style.css', 'script.js', 'manifest.json', 'sw.js', 'meta.json']) {
      const p = `${baseDir}/${f}`;
      if ((await readFile(p)) !== null) filesToDelete.push(p);
    }
    if ((await readFile(receiptPath)) !== null) filesToDelete.push(receiptPath);

    const existed = filesToDelete.length > 0;
    manifest = manifest.filter((e) => e.project !== slug);
    const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

    // Single atomic commit: update manifest + remove all files together
    await atomicCommit({ [MANIFEST_PATH]: manifestJson }, filesToDelete, `chore: delete ${slug}`);
    await syncCheckout();

    await finishStatus(issue, existed ? `🗑 Deleted \`${slug}\` (${filesToDelete.length} files).` : `\`${slug}\` did not exist.`, true);
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

  let inspirationCtx = '';
  if (mode === 'inspire') {
    const searchRes = await step(`Searching GitHub for "${prompt.slice(0, 60)}…"`, () => searchGitHubForInspiration(prompt));
    if (searchRes.inspiration) {
      inspirationCtx = `\n\nHere are some highly successful open-source apps for inspiration. Extract their best UI/UX patterns and logic, but write the code entirely from scratch:\n${searchRes.inspiration}`;
      ask = `Build a brand new app based on this idea: ${prompt}. Use the provided inspiration code as a style and feature guide, but DO NOT copy it verbatim. Make it better.`;
    } else {
      ask = prompt;
    }
  }

  let fullPrompt = RULES + ask + inspirationCtx;
  if (existingHtml) {
    if (existingHtml.length > EXISTING_LIMIT) existingHtml = existingHtml.slice(0, EXISTING_LIMIT);
    if (existingCss.length > CSS_JS_LIMIT) existingCss = existingCss.slice(0, CSS_JS_LIMIT);
    if (existingJs.length > CSS_JS_LIMIT) existingJs = existingJs.slice(0, CSS_JS_LIMIT);
    fullPrompt += `\n\nCURRENT FILES:\n[index.html]:\n${existingHtml}\n\n[style.css]:\n${existingCss}\n\n[script.js]:\n${existingJs}`;
  }

  let cand = await step('Generate with AI (model race)', () => generate(fullPrompt), { promptChars: fullPrompt.length });
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

  // ============================================================
  // PATCH 2: re-normalize right after assigning files
  // ============================================================
  let files = cand.grade.files;
  // Defensive re-normalization (in case a lib mutated files)
  for (const [k, v] of Object.entries(files)) {
    if (typeof v !== 'string') files[k] = Array.isArray(v) ? v.join('\n') : String(v);
  }
  let testHtml = cand.grade.html;
  let smoke = cand.grade.smoke;
  let meta = cand.grade.meta;
  let provider = cand.provider; let model = cand.model;

  steps.push({ name: 'Smoke test', status: smoke.ok ? 'done' : 'error', at: new Date().toISOString(), note: 'ran during the model race', error: smoke.ok ? undefined : `${smoke.errors.length} runtime error(s)` });
  await pushProgress();

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

  const security = await step('Security scan', () => runAllScanners(testHtml));

  let score = 100;
  if (!smoke.ok) score -= 30;
  if (smoke.errors.length > 0) score -= Math.min(smoke.errors.length * 5, 20);
  if (security.counts.high > 0) score -= 20;
  if (security.counts.medium > 0) score -= 10;
  if (testHtml.length > 50000) score -= 5;

  if (score < 50) {
    const report = `❌ **Build Failed: Score too low (${score}/100)**\n\n`;
    const errors = smoke.errors.length ? `\n**Runtime Errors:**\n${smoke.errors.map(e => `- ${e}`).join('\n')}` : '';
    const secs = security.findings.length ? `\n**Security Issues:**\n${security.findings.map(f => `- [${f.sev}] ${f.msg}`).join('\n')}` : '';
    await finishStatus(issue, report + errors + secs + '\n\nThe broken code was **not** committed.', false);
    await pushProgress({ status: 'error' });
    process.exit(1);
  }

  let currentHtml = files['index.html'];
  if (!currentHtml.includes('Built by Ariotica')) {
    const watermark = `\n<!-- Built by Ariotica AI -->\n<div style="position:fixed;bottom:12px;right:12px;opacity:0.35;font-size:11px;font-family:monospace;color:white;pointer-events:none;z-index:9999;">⚡ Ariotica</div>`;
    currentHtml = currentHtml.replace(/<\/body>/i, `${watermark}\n</body>`);
  }

  const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:;">`;
  if (!currentHtml.includes('Content-Security-Policy')) {
    currentHtml = currentHtml.replace('<head>', `<head>\n  ${cspTag}`);
  }

  // ---- Theme color (deterministic from slug) ----
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  const color = `hsl(${Math.abs(hash % 360)}, 70%, 50%)`;
  const letter = slug.charAt(0).toUpperCase();

  // ---- PWA manifest ----
  const manifestPwa = {
    name: slug.replace(/-/g, ' ').toUpperCase(),
    short_name: slug,
    start_url: ".",
    display: "standalone",
    background_color: "#0b1410",
    theme_color: color,
    icons: [{
      src: `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230b1410'/><text x='50%' y='55%' font-size='60' fill='${encodeURIComponent(color)}' font-family='system-ui' font-weight='bold' text-anchor='middle' dominant-baseline='middle'>${letter}</text></svg>`,
      sizes: "512x512",
      type: "image/svg+xml"
    }]
  };
  files['manifest.json'] = JSON.stringify(manifestPwa, null, 2);

  // ---- Inject manifest link + SW registration into HTML BEFORE hashing ----
  if (!currentHtml.includes('rel="manifest"')) {
    currentHtml = currentHtml.replace('</head>', `  <link rel="manifest" href="manifest.json">\n  <meta name="theme-color" content="${color}">\n</head>`);
  }
  if (!currentHtml.includes('serviceWorker.register')) {
    currentHtml = currentHtml.replace('</body>', `<script>if('serviceWorker' in navigator){addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})})}</script>\n</body>`);
  }
  files['index.html'] = currentHtml;

  // ---- T2: content-hashed service worker ----
  const staticHash = (() => {
    const h = crypto.createHash('sha256');
    for (const name of ['index.html', 'style.css', 'script.js', 'manifest.json'].sort()) {
      if (!files[name]) continue;
      h.update(name); h.update('\0');
      h.update(files[name]); h.update('\0');
    }
    return h.digest('hex');
  })();

  const precache = ['./', './index.html'];
  if (files['style.css']) precache.push('./style.css');
  if (files['script.js']) precache.push('./script.js');
  if (files['manifest.json']) precache.push('./manifest.json');

  const cacheName = `app-${slug}-${staticHash.slice(0, 8)}`;
  files['sw.js'] = `/* Ariotica SW · ${cacheName} */
const CACHE = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations so updates land immediately
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Stale-while-revalidate for static assets
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
`;

  let grade = 'F';
  if (score >= 90) grade = 'A+';
  else if (score >= 80) grade = 'A';
  else if (score >= 70) grade = 'B';
  else if (score >= 60) grade = 'C';

  let version = '1.0.0';
  if (meta.version) version = meta.version;
  else {
    try {
      const oldMeta = JSON.parse(await readFile(`${baseDir}/meta.json`) || '{}');
      if (oldMeta.version) {
        const parts = oldMeta.version.split('.').map(Number);
        parts[2] += 1;
        version = parts.join('.');
      }
    } catch {}
  }

  const metaJson = {
    version: version,
    features: Array.isArray(meta.features) ? meta.features : [],
    fixes: Array.isArray(meta.fixes) ? meta.fixes : [],
    suggestions: Array.isArray(meta.suggestions) ? meta.suggestions : [],
    grade: grade,
    percentile: score >= 90 ? 'Top 5%' : score >= 80 ? 'Top 20%' : 'Top 50%',
    humanInvolvement: meta.humanInvolvement || 'None',
    libraries: Array.isArray(meta.libraries) ? meta.libraries : ['None'],
    _watermark: "⚡ Built by Ariotica AI"
  };
  files['meta.json'] = JSON.stringify(metaJson, null, 2);

  const receipt = R.buildReceipt({ repo: `${OWNER}/${REPO}`, slug, files, mode, runId: RUN_ID, commit: null, provider, model, race: raceReport, smoke, security: security.counts, prompt, vanilla: T.isVanilla(testHtml) });
  files[receiptPath] = JSON.stringify(receipt, null, 2) + '\n';

  const idx = manifest.findIndex((e) => e.project === slug);
  const entry = { 
    project: slug, file: mainFile, prompt: prompt.slice(0, 240), created: new Date().toISOString().slice(0, 19), mode, provider, model, 
    findings: security.counts.total, smoke: smoke.ok ? 'pass' : `fail:${smoke.errors.length}`, size: Object.values(files).reduce((a, b) => a + b.length, 0),
    version: version, features: metaJson.features, fixes: metaJson.fixes, suggestions: metaJson.suggestions,
    grade: grade, percentile: metaJson.percentile, humanInvolvement: metaJson.humanInvolvement, libraries: metaJson.libraries,
    sha256: receipt.sha256, receipt: receiptPath 
  };
  if (idx === -1) manifest.push(entry); else manifest[idx] = Object.assign({}, manifest[idx], entry);
  files[MANIFEST_PATH] = JSON.stringify(manifest, null, 2) + '\n';

  const fullFiles = {};
  for (const [filename, content] of Object.entries(files)) {
    if (filename === MANIFEST_PATH || filename === receiptPath) {
      fullFiles[filename] = content;
    } else {
      fullFiles[`${baseDir}/${filename}`] = content;
    }
  }

  const startTime = Date.now();
  const commitSha = await step(`Commit files to ${baseDir}/`, () => atomicCommit(fullFiles, [], `feat: ${slug} v${version} (${mode})`));

  // Second commit back-fills the real commit SHA into the receipt.
  receipt.commit = commitSha;
  files[receiptPath] = JSON.stringify(receipt, null, 2) + '\n';
  await atomicCommit({ [receiptPath]: files[receiptPath] }, [], `chore: receipt ${slug}`);

  // Refresh the runner's checkout so build-index.js / artifact upload / NEW_COMMIT see the push
  await syncCheckout();

  const url = `https://${OWNER}.github.io/${REPO}/${baseDir}/`;
  const folderUrl = `https://github.com/${OWNER}/${REPO}/tree/${BRANCH}/${baseDir}`;

  // 1. First comment: build summary
  let body = `✅ **${mode}** complete: \`${baseDir}/\` via **${provider}**${model ? ` (${model})` : ''}\n\n`;
  body += `🌐 **Live App:** ${url}\n`;
  body += `📁 **Source Code:** ${folderUrl}\n`;

  const rl = raceLine(raceReport); if (rl) body += `\n🏁 Model race: ${rl}`;
  if (!smoke.skipped) body += smoke.ok ? '\n\n🧪 Smoke test: passed' : `\n\n🧪 Smoke test: ⚠️ ${smoke.errors.length} runtime issue(s) remain\n${smoke.errors.slice(0, 3).map((e) => '- ' + e).join('\n')}`;
  body += `\n\n🧾 Receipt: [\`sha256:${receipt.sha256.slice(0, 12)}…\`](https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/${receiptPath}) · zero-deps ${receipt.checks.zeroDeps ? '✅' : '⚠️'} · verify with \`node verify-receipt.js ${slug}\``;

  if (version) body += `\n\n**🏷️ Version:** \`v${version}\``;
  if (metaJson.features.length) body += `\n\n**✨ New Features:**\n${metaJson.features.map(f => `- ${f}`).join('\n')}`;
  if (metaJson.fixes.length) body += `\n\n**🔧 Bugs Fixed:**\n${metaJson.fixes.map(f => `- ${f}`).join('\n')}`;
  if (security.findings.length) body += `\n\n**Scanner findings (${security.findings.length}):**\n` + security.findings.slice(0, 5).map((f) => `- [${f.sev}] ${f.msg}`).join('\n');

  await finishStatus(issue, body + HINT, false);

  // 2. Wait for GitHub Pages to build the new files
  const isDeployed = await waitForPagesBuild(startTime);

  // 3. Second comment: clickable screenshot + links
  if (isDeployed && issue) {
    const screenshotUrl = `https://image.thum.io/get/width/1200/crop/900/${url}?t=${Date.now()}`;
    try {
      const previewBody = [
        `### 📸 Live Preview — \`${slug}\``,
        '',
        `🌐 **Open app:** ${url}`,
        `📁 **Source:** ${folderUrl}`,
        '',
        `[![${slug} screenshot](${screenshotUrl})](${url})`,
        '',
        `_Screenshot refreshes on each build · click to open_`,
      ].join('\n');

      await octokit.issues.createComment({
        owner: OWNER, repo: REPO, issue_number: issue,
        body: previewBody,
      });
    } catch (e) {
      console.log('Failed to post screenshot comment:', e.message);
    }
  }

  if (issue) {
    try { await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' }); } catch {}
  }

  await pushProgress({ status: 'done', securitySummary: security.counts, smoke: smoke.ok ? 'pass' : 'fail', sha256: receipt.sha256 });
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