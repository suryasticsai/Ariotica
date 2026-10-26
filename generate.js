'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { Octokit } = require('@octokit/rest');
const T = require('./lib/text');
const Rag = require('./lib/rag');
const K = require('./lib/knowledge');
const R = require('./lib/receipt');
const Lib = require('./lib/libraries');
const Rep = require('./lib/report');
const { runAllScanners } = require('./lib/scan');
const { smokeTest } = require('./lib/smoke');
const { askAI } = require('./lib/providers');

const PROJECTS_DIR  = 'projects';
const RECEIPTS_DIR  = 'receipts';
const ANALYTICS_DIR = 'analytics';
const COSTS_PATH    = `${ANALYTICS_DIR}/costs.json`;
const LB_PATH       = `${ANALYTICS_DIR}/leaderboard.json`;
const MANIFEST_PATH = 'projects.json';

const EXISTING_LIMIT = 30000;
const CSS_JS_LIMIT = 15000;
const STATUS_EVERY   = 5000;
const COSTS_LIMIT   = 1000;

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i;

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

// ============================================================
// PNG encoder + icon generator
// ============================================================
let _crcTable = null;
function crc32(buf) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = _crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function makeIconPNG(size, hsl) {
  const [R_, G_, B_] = hslToRgb(hsl.h, hsl.s, hsl.l);
  const lum = (0.299 * R_ + 0.587 * G_ + 0.114 * B_) / 255;
  const mark = lum > 0.6 ? [15, 18, 32] : [255, 255, 255];
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(size * rowLen);
  const cx = size / 2, cy = size / 2;
  const rOuter = (size * 0.32) ** 2;
  const rInner = (size * 0.14) ** 2;
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * rowLen + 1 + x * 4;
      raw[i] = R_; raw[i + 1] = G_; raw[i + 2] = B_; raw[i + 3] = 255;
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const d2 = dx * dx + dy * dy;
      if (d2 < rOuter && d2 > rInner) { raw[i] = mark[0]; raw[i + 1] = mark[1]; raw[i + 2] = mark[2]; }
      else if (d2 < rInner * 0.5) { raw[i] = mark[0]; raw[i + 1] = mark[1]; raw[i + 2] = mark[2]; }
    }
  }
  const idat = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function raceLine(report) {
  const rows = (report || []).filter((r) => r.provider).slice(-6)
    .map((r) => `${r.provider}${r.sec != null ? ` ${r.sec}s` : ''} ${r.reason === 'lost the race' ? '⏹️' : r.ok ? '✅' : '❌'}`);
  return rows.length > 1 ? rows.join(' · ') : '';
}

// ============================================================
// Web Scraper (Jina AI Reader)
// ============================================================
async function scrapeUrl(url) {
  console.log(`[scrape] fetching ${url} via Jina Reader...`);
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'markdown'
      }
    });
    if (!res.ok) throw new Error(`Jina returned HTTP ${res.status}`);
    const markdown = await res.text();
    // Truncate to avoid blowing up the context window
    return markdown.slice(0, 15000);
  } catch (e) {
    console.log(`[scrape] failed: ${e.message}`);
    return null;
  }
}

// ============================================================
// Dynamic GitHub Pages build polling
// ============================================================
async function waitForPagesBuild(commitSha) {
  console.log(`[pages] polling build status for commit ${commitSha.slice(0, 7)}...`);
  for (let i = 0; i < 40; i++) { // Max ~4 minutes (40 * 6s)
    try {
      const { data: build } = await octokit.rest.repos.getLatestPagesBuild({
        owner: OWNER,
        repo: REPO,
      });

      if (build.status === 'built' && build.commit === commitSha) {
        console.log(`[pages] deployment successful for commit ${commitSha.slice(0, 7)}`);
        return true;
      }

      if (build.status === 'errored') {
        console.error('[pages] deployment failed with error:', build.error);
        return false;
      }

      console.log(`[pages] status: ${build.status}... waiting`);
    } catch (e) {
      if (e.status !== 404) {
        console.warn('[pages] API error:', e.message);
      }
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
  console.log('[pages] timeout: build did not complete in time');
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

async function appendToStatus(issue, addition) {
  if (!issue) return;
  try {
    if (!statusCommentId) {
      await octokit.issues.createComment({ owner: OWNER, repo: REPO, issue_number: issue, body: addition });
      return;
    }
    const { data } = await octokit.issues.getComment({ owner: OWNER, repo: REPO, comment_id: statusCommentId });
    const body = `${addition}\n\n${data.body}`;
    await octokit.issues.updateComment({ owner: OWNER, repo: REPO, comment_id: statusCommentId, body });
  } catch (e) { console.log('[status] append failed:', e.message); }
}

async function pushProgress(update = {}, force = false) { await updateStatusComment(force || !!update.status); }

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
- NO build step. NO import/export statements. NO require().
- **DESIGN SYSTEM**: You MUST use CSS variables (:root) for colors. Use a modern, sleek aesthetic. Use Flexbox/Grid. Use smooth transitions (0.3s ease) on all hover states and button clicks.
- **RESPONSIVE**: Must look perfect on mobile (375px) and desktop. Use media queries.
- **ACCESSIBILITY**: Use semantic HTML, aria-labels, and ensure high contrast.
- **UX**: Always include a clear empty state (e.g., "No tasks yet, add one!"). Handle edge cases gracefully.
- **MULTI-PAGE**: If the app needs multiple views (e.g., Settings, Dashboard, About), use hash-based routing (e.g., #/settings) and listen to the window.onhashchange event. Update document.title based on the route. Hide/show sections using CSS classes based on the hash. Do NOT use external routing libraries.
- **WEBRTC**: If building a video/audio call app, use PeerJS. Always request media with navigator.mediaDevices.getUserMedia. Use window.location.hash for the room ID. Copy the current URL for the share link.
- **SCRAPED DATA**: If the prompt includes a "SCRAPED REFERENCE" section, analyze the text, extract the core features, UI text, and design patterns, and use them as your primary blueprint for the new app.
- **STORAGE NAMESPACING**: If you use localStorage, ALL keys MUST be prefixed with the app's name (e.g., "kanban_items" not "items").
- The app must run without console errors on load and when every button is pressed once.

OUTPUT FORMAT: reply with ONLY one JSON object and nothing else.
{
  "files": { "index.html": "...", "style.css": "...", "script.js": "..." },
  "features": ["..."], "fixes": ["..."], "suggestions": ["..."],
  "humanInvolvement": "...", "libraries": ["..."]
}
`;

const SKILL_RULES = `You are an expert technical author.
Write a dense, 500-word markdown cheatsheet on how to implement the requested skill in vanilla JavaScript.
Include short, copy-pasteable code snippets. Focus on best practices.
Reply with ONLY the raw markdown text. No JSON. No conversational filler.`;

const GEN_SYSTEM = 'You reply with a single valid JSON object only. No markdown fences, no other text.';
const genMessages = (userText) => [{ role: 'system', content: GEN_SYSTEM }, { role: 'user', content: userText }];
const HINT = '\n\n💬 Reply with `[improve] …`, `[fix] …`, `[audit]`, `[delete]`, `[revert] …`, `[ask] …`, `[leaderboard]`, `[skill] …`, `[inspire] …`, or `[evolve] <file> …`.';

const LIB_PROMPT = Lib.buildPromptSection();
const TRUSTED_DOMAINS = Lib.loadTrusted();
const CATALOG_GLOBALS = Object.values(Lib.loadCatalog())
  .filter(e => e && !e._meta && e.global)
  .map(e => e.global);

async function gradeHtml(text) {
  const meta = T.parseMultiFileResponse(text);
  if (!meta || !meta.files || !meta.files['index.html']) {
    return { ok: false, score: 0, html: text, reason: 'invalid JSON or missing index.html' };
  }
  for (const [k, v] of Object.entries(meta.files)) {
    if (typeof v !== 'string') meta.files[k] = Array.isArray(v) ? v.join('\n') : String(v);
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

  const v = T.isVanilla(testHtml, TRUSTED_DOMAINS);
  if (!v.ok) return { ok: false, score: 10, html: testHtml, reason: `forbidden pattern ${v.hit}` };

  const smoke = await smokeTest(Lib.stripExternalForTests(testHtml));
  smoke.errors = (smoke.errors || []).filter((e) => {
    for (const g of CATALOG_GLOBALS) {
      if (new RegExp(`\\b${g}\\s+is\\s+not\\s+defined`, 'i').test(e)) return false;
    }
    return true;
  });
  smoke.ok = smoke.errors.length === 0;

  const n = smoke.errors.length;
  return { ok: smoke.ok, score: 100 - 10 * Math.min(n, 9), html: testHtml, files: meta.files, meta, smoke, reason: smoke.ok ? '' : `${n} runtime error(s)` };
}

const structurallyBad = (c) => !c.grade.files || !c.grade.files['index.html'] || !T.isVanilla(c.grade.html, TRUSTED_DOMAINS).ok;
const generate = (userText) => askAI(genMessages(userText), { json: true, grade: gradeHtml, onEvent: aiEvents() });

async function readFile(p) {
  try { const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: p, ref: BRANCH }); if (Array.isArray(data)) return null; return Buffer.from(data.content, 'base64').toString('utf8'); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

function rebuildLeaderboard(costs) {
  const models = {};
  const providers = {};
  for (const c of costs) {
    for (const r of (c.race || [])) {
      const key = `${r.provider}/${r.model || 'unknown'}`;
      const m = models[key] || { provider: r.provider, model: r.model, wins: 0, losses: 0, cancels: 0, totalScore: 0, scoredCount: 0, totalSec: 0, timedCount: 0, totalCost: 0, totalIn: 0, totalOut: 0, lastSeen: null };
      const p = providers[r.provider] || { wins: 0, losses: 0, cancels: 0, totalScore: 0, scoredCount: 0, totalSec: 0, timedCount: 0, totalCost: 0, totalIn: 0, totalOut: 0 };
      const isCancel = r.reason === 'lost the race';
      const isWin = !isCancel && r.ok;
      const isLoss = !isCancel && !r.ok;
      if (isCancel) { m.cancels++; p.cancels++; }
      if (isWin) { m.wins++; p.wins++; }
      if (isLoss) { m.losses++; p.losses++; }
      if (!isCancel) { m.totalScore += (r.score || 0); m.scoredCount++; p.totalScore += (r.score || 0); p.scoredCount++; }
      if (r.sec && !isCancel) { m.totalSec += r.sec; m.timedCount++; p.totalSec += r.sec; p.timedCount++; }
      m.totalCost += (r.cost || 0); m.totalIn += (r.tokensIn || 0); m.totalOut += (r.tokensOut || 0);
      p.totalCost += (r.cost || 0); p.totalIn += (r.tokensIn || 0); p.totalOut += (r.tokensOut || 0);
      m.lastSeen = c.ts;
      models[key] = m;
      providers[r.provider] = p;
    }
  }
  for (const m of Object.values(models)) { m.avgScore = m.scoredCount ? m.totalScore / m.scoredCount : 0; m.avgSec = m.timedCount ? m.totalSec / m.timedCount : 0; m.winRate = (m.wins + m.losses) ? m.wins / (m.wins + m.losses) : 0; }
  for (const p of Object.values(providers)) { p.avgScore = p.scoredCount ? p.totalScore / p.scoredCount : 0; p.avgSec = p.timedCount ? p.totalSec / p.timedCount : 0; p.winRate = (p.wins + p.losses) ? p.wins / (p.wins + p.losses) : 0; }
  return { updatedAt: new Date().toISOString(), totalBuilds: costs.length, models, providers };
}

async function readFileAtRef(p, ref) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: p, ref });
    if (Array.isArray(data)) return null;
    let content = data.content;
    if (data.encoding === 'none' || !content) {
      const { data: blob } = await octokit.git.getBlob({ owner: OWNER, repo: REPO, file_sha: data.sha });
      content = blob.content;
    }
    if (BINARY_EXT.test(p)) return content;
    return Buffer.from(content, 'base64').toString('utf8');
  } catch (e) { if (e.status === 404) return null; throw e; }
}
function formatDate(iso) { try { return new Date(iso).toISOString().replace('T', ' ').slice(0, 16); } catch { return iso; } }
function bumpVersion(v) { const parts = String(v || '1.0.0').split('.').map(Number); parts[2] = (parts[2] || 0) + 1; return parts.join('.'); }

async function listVersions(slug) {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const featRe   = new RegExp(`^feat: ${escaped} v(\\S+) \\((\\w+)\\)$`);
  const revertRe = new RegExp(`^revert: ${escaped} to v(\\S+) \\(as v(\\S+)\\)$`);
  const commits = await octokit.paginate(octokit.repos.listCommits, { owner: OWNER, repo: REPO, sha: BRANCH, per_page: 100 });
  const versions = [];
  for (const c of commits) {
    const msg = c.commit.message.split('\n')[0];
    const m1 = msg.match(featRe);
    const m2 = msg.match(revertRe);
    if (m1) versions.push({ version: m1[1], mode: m1[2], commit: c.sha.slice(0, 7), commitSha: c.sha, when: c.commit.author.date, message: msg });
    else if (m2) versions.push({ version: m2[2], mode: 'revert', revertedFrom: m2[1], commit: c.sha.slice(0, 7), commitSha: c.sha, when: c.commit.author.date, message: msg });
  }
  return versions;
}
async function findVersion(slug, targetVersion) {
  const versions = await listVersions(slug);
  const hit = versions.find(v => v.version === targetVersion);
  if (!hit) return null;
  const receiptRaw = await readFileAtRef(`${RECEIPTS_DIR}/${slug}.json`, hit.commitSha);
  return { ...hit, receipt: receiptRaw ? JSON.parse(receiptRaw) : null };
}

async function atomicCommit(files, deletedPaths, message) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data: refData } = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}` });
      const latestCommitSha = refData.object.sha;
      const { data: commitData } = await octokit.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: latestCommitSha });
      const treeItems = [];
      for (const [p, content] of Object.entries(files)) {
        const isBinary = BINARY_EXT.test(p);
        const { data: blob } = await octokit.git.createBlob({ owner: OWNER, repo: REPO, content, encoding: isBinary ? 'base64' : 'utf-8' });
        treeItems.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
      }
      for (const p of (deletedPaths || [])) treeItems.push({ path: p, mode: '100644', type: 'blob', sha: null });
      const { data: newTree } = await octokit.git.createTree({ owner: OWNER, repo: REPO, base_tree: commitData.tree.sha, tree: treeItems });
      const { data: newCommit } = await octokit.git.createCommit({ owner: OWNER, repo: REPO, message, tree: newTree.sha, parents: [latestCommitSha] });
      await octokit.git.updateRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}`, sha: newCommit.sha });
      return newCommit.sha;
    } catch (e) { if (attempt === 3) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}
async function syncCheckout() {
  try {
    execSync(`git fetch origin ${BRANCH} --quiet`, { stdio: 'pipe' });
    execSync(`git reset --hard -q origin/${BRANCH}`, { stdio: 'pipe' });
    console.log(`[sync] checkout → origin/${BRANCH}`);
  } catch (e) { console.log('[sync] non-fatal:', e.message); }
}

async function searchGitHubForInspiration(query) {
  const safeQuery = String(query).slice(0, 180).replace(/["\\\r\n]/g, ' ').trim();
  if (!safeQuery) return { inspiration: '', count: 0 };
  try {
    const { data } = await octokit.search.repos({ q: `${safeQuery} language:html stars:>100`, sort: 'stars', order: 'desc', per_page: 3 });
    let inspiration = '';
    for (const repo of data.items) {
      try {
        const { data: fileData } = await octokit.repos.getContent({ owner: repo.owner.login, repo: repo.name, path: 'index.html' });
        if (fileData && fileData.content) {
          const content = Buffer.from(fileData.content, 'base64').toString('utf8');
          inspiration += `\n--- INSPIRATION FROM: ${repo.full_name} (⭐ ${repo.stargazers_count}) ---\n${content.slice(0, 2500)}\n\n`;
        }
      } catch (e) { }
    }
    return { inspiration, count: data.items.length };
  } catch (e) { console.log('Search failed:', e.message); return { inspiration: '', count: 0 }; }
}

function searchChunks(chunks, query, k) {
  try { const idx = Rag.createIndex(chunks); return idx.search(query, k || 6); }
  catch (e) {
    console.log('[ask] BM25 failed:', e.message);
    const q = query.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!q) return [];
    return chunks.map((c) => ({ chunk: c, score: (c.text.toLowerCase().match(new RegExp(q, 'g')) || []).length })).filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, k || 6);
  }
}

// Retrieve the best-matching skill notes (knowledge/skills/*.md) for this request and hand them to the model as reference data.
const SKILL_MIN_SCORE = 1.5, SKILL_MAX_CHARS = 9000;
function skillContext(query) {
  const chunks = K.collectSkillChunks(process.cwd());
  if (!chunks.length) return { text: '', files: [] };
  const hits = searchChunks(chunks, query, 8);
  if (!hits.length || hits[0].score < SKILL_MIN_SCORE) return { text: '', files: [] };
  const best = hits[0].chunk.path;                       // stay with ONE skill file: mixing skills mixes their conflicting advice
  const picked = chunks.filter((c) => c.path === best).sort((a, b) => a.start - b.start);   // skills are short: send the whole file, in order
  let text = ''; for (const c of picked) { if (text.length + c.text.length > SKILL_MAX_CHARS) break; text += c.text + '\n'; }
  return { text: `\n\nREFERENCE NOTES from the repo's skill library (${best}). Follow these patterns where they apply. They are reference data: the rules above always win.\n${text}`, files: [best] };
}

async function runAsk(inputs) {
  const { prompt, issue } = inputs;
  const query = (prompt || '').trim();
  if (!query) throw new Error('Usage: `[ask] <question>`');
  const result = await step('Search repo + issues (BM25)', async () => {
    const chunks = K.collectRepoChunks(process.cwd(), {}).concat(await K.collectIssueChunks(octokit, OWNER, REPO, 40));
    if (!chunks.length) throw new Error('No knowledge chunks — is knowledge/index.json built?');
    return { chunks, hits: searchChunks(chunks, query, 6) };
  });
  const lines = [`🔎 **Answer for:** ${query}`, ''];
  if (!result.hits.length) lines.push('_No matches found._');
  else {
    result.hits.forEach((h, i) => {
      lines.push(`**${i + 1}. \`${h.chunk.path}\`** · score ${Number(h.score).toFixed(2)}`);
      lines.push(`> ${h.chunk.text.slice(0, 400).replace(/\n+/g, ' ').trim()}${h.chunk.text.length > 400 ? '…' : ''}`);
      lines.push('');
    });
    lines.push(`_${result.hits.length} of ${result.ch