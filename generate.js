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
// AI Logo Generator (Pollinations)
// ============================================================
async function fetchAILogo(slug, features) {
  const featureText = (features && features.length) ? features.slice(0, 2).join(', ') : 'utility tool';
  const prompt = encodeURIComponent(`A minimalist modern flat vector app icon for an app called "${slug}" that does ${featureText}. Simple shapes, solid vibrant colors, high contrast, no text, centered composition.`);
  const url = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true`;

  console.log(`[logo] generating AI logo for ${slug}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('Image too small, likely an error page');
    return buf.toString('base64');
  } catch (e) {
    console.log(`[logo] failed: ${e.message}. Falling back to geometric icon.`);
    return null;
  }
}

// ============================================================
// PNG encoder + fallback icon generator
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
  for (let i = 0; i < 40; i++) {
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

  // If the workflow already posted a "Spinning up..." comment, take it over.
  const quickAckId = process.env.QUICK_ACK_ID;
  if (quickAckId && !isNaN(parseInt(quickAckId, 10))) {
    statusCommentId = parseInt(quickAckId, 10);
    await updateStatusComment(true);
    return;
  }

  // Fallback: create a new one (for local testing or workflow_dispatch)
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

// Upgraded Skill Rules for better RAG parsing
const SKILL_RULES = `You are an expert technical author.
Write a dense markdown cheatsheet on how to implement the requested skill in vanilla JavaScript.
You MUST use exactly this structure:
# [Skill Name]
Keywords: [comma separated list of search terms]
## Pattern
[Short, copy-pasteable code snippets]
## Gotchas
[Edge cases, browser limits, async pitfalls]
Reply with ONLY the raw markdown text. No JSON. No conversational filler.`;

const GEN_SYSTEM = 'You reply with a single valid JSON object only. No markdown fences, no other text.';
const genMessages = (userText) => [{ role: 'system', content: GEN_SYSTEM }, { role: 'user', content: userText }];
const HINT = '\n\n💬 Reply with `[improve] …`, `[fix] …`, `[audit]`, `[delete]`, `[revert] …`, `[ask] …`, `[leaderboard]`, `[skill] …`, `[skills]`, `[inspire] …`, or `[evolve] <file> …`.';

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

// Retrieve the best-matching skill notes, or force a specific skill via "skill:name"
const SKILL_MIN_SCORE = 1.5, SKILL_MAX_CHARS = 9000;
function skillContext(query) {
  const chunks = K.collectSkillChunks(process.cwd());
  if (!chunks.length) return { text: '', files: [] };

  // Check if the user forced a specific skill (e.g., "use skill:webrtc")
  const forceMatch = query.match(/skill:([a-z0-9-]+)/i) || query.match(/use\s+([a-z0-9-]+)\s+skill/i);
  let best = null;

  if (forceMatch) {
    const target = forceMatch[1].toLowerCase();
    const forced = chunks.find(c => c.path.toLowerCase().includes(target));
    if (forced) best = forced.path;
  }

  if (!best) {
    const hits = searchChunks(chunks, query, 8);
    if (!hits.length || hits[0].score < SKILL_MIN_SCORE) return { text: '', files: [] };
    best = hits[0].chunk.path;
  }

  const picked = chunks.filter((c) => c.path === best).sort((a, b) => a.start - b.start);
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
    lines.push(`_${result.hits.length} of ${result.chunks.length} chunks shown._`);
  }
  await finishStatus(issue, lines.join('\n'), true);
  await pushProgress({ status: 'done' });
}

async function runLeaderboard(issue) {
  const result = await step('Loading analytics', async () => {
    const lbRaw = await readFile(LB_PATH);
    const costsRaw = await readFile(COSTS_PATH);
    const lb = lbRaw ? JSON.parse(lbRaw) : { updatedAt: null, totalBuilds: 0, models: {}, providers: {} };
    const costs = costsRaw ? JSON.parse(costsRaw) : [];
    return { lb, costs };
  });
  const { lb, costs } = result;
  const totalCost = costs.reduce((s, c) => s + (c.cost || 0), 0);
  const totalIn = costs.reduce((s, c) => s + (c.tokensIn || 0), 0);
  const totalOut = costs.reduce((s, c) => s + (c.tokensOut || 0), 0);

  const lines = [`📊 **Ariotica Leaderboard**`, ''];
  lines.push(`**Lifetime:** ${costs.length} builds · $${totalCost.toFixed(4)} spent · ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out tokens`);

  const topModels = Object.values(lb.models || {}).filter(m => (m.wins + m.losses) >= 2).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins).slice(0, 10);
  if (topModels.length) {
    lines.push('', '### 🏆 Top Models (min 2 races)');
    lines.push('| Model | Wins | Losses | Win Rate | Avg Score | Avg Sec | Cost |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const m of topModels) lines.push(`| \`${m.model}\` | ${m.wins} | ${m.losses} | ${(m.winRate * 100).toFixed(0)}% | ${m.avgScore.toFixed(1)} | ${m.avgSec.toFixed(1)}s | $${(m.totalCost || 0).toFixed(4)} |`);
  }

  const days = {};
  for (const c of costs) {
    const day = (c.ts || '').slice(0, 10);
    if (!day) continue;
    days[day] = days[day] || { cost: 0, builds: 0, tin: 0, tout: 0 };
    days[day].cost += c.cost || 0; days[day].builds++; days[day].tin += c.tokensIn || 0; days[day].tout += c.tokensOut || 0;
  }
  const dayKeys = Object.keys(days).sort().slice(-7);
  if (dayKeys.length) {
    lines.push('', '### 💰 Cost by Day (last 7)');
    lines.push('| Date | Builds | Cost | Tokens In | Tokens Out |');
    lines.push('|---|---|---|---|---|');
    for (const d of dayKeys) { const x = days[d]; lines.push(`| ${d} | ${x.builds} | $${x.cost.toFixed(4)} | ${x.tin.toLocaleString()} | ${x.tout.toLocaleString()} |`); }
  }

  const recent = costs.slice(-10).reverse();
  if (recent.length) {
    lines.push('', '### 📜 Recent Builds');
    lines.push('| When | Slug | Mode | Winner | Cost |');
    lines.push('|---|---|---|---|---|');
    for (const c of recent) lines.push(`| ${(c.ts || '').slice(0, 16).replace('T', ' ')} | \`${c.slug}\` | ${c.mode} | ${c.provider}/${c.model || '?'} | $${(c.cost || 0).toFixed(4)} |`);
  }

  await finishStatus(issue, lines.join('\n') + HINT, false);
  await pushProgress({ status: 'done' });
}

// New mode: List all available skills
async function runSkills(issue) {
  const dir = path.join(process.cwd(), 'knowledge', 'skills');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch { }

  const lines = [`🧠 **Ariotica Skill Library**`, ''];
  if (!files.length) {
    lines.push('_No skills found. Teach me something with `[BUILD] name [skill] <topic>`_');
  } else {
    lines.push(`Currently I have learned **${files.length}** skills. The next time you build an app, I will automatically scan these files and use them as reference blueprints.`);
    lines.push('');
    lines.push('| Skill | Description |');
    lines.push('|---|---|');
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(dir, f), 'utf8');
        const firstLine = content.split('\n').find(l => l.trim().length > 0) || f;
        const title = firstLine.replace(/^#+\s*/, '').trim();
        lines.push(`| \`${f.replace('.md', '')}\` | ${title} |`);
      } catch {
        lines.push(`| \`${f.replace('.md', '')}\` | _(unreadable)_ |`);
      }
    }
    lines.push('');
    lines.push('💡 **Pro-tip:** You can force me to use a specific skill by adding `use skill:name` to your prompt. (e.g., `[BUILD] app [create] use skill:webrtc`)');
  }

  await finishStatus(issue, lines.join('\n') + HINT, true);
  await pushProgress({ status: 'done' });
}

function resolveInputs() {
  const dProj = (process.env.DISPATCH_PROJECT || '').trim();
  if (dProj) return { project: dProj, prompt: (process.env.DISPATCH_PROMPT || '').trim(), mode: (process.env.DISPATCH_MODE || 'create').toLowerCase(), issue: null, commentId: null };
  const num = parseInt(process.env.ISSUE_NUMBER || '0', 10) || null;
  const tm = T.parseTitle(process.env.ISSUE_TITLE || '');
  if (!tm) throw new Error('Title must be: [BUILD] name [mode]');
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

function reportCtx({ slug, baseDir, mode, version, provider, model, raceReport, smoke, security, metaJson, resolved, totalCost, totalIn, totalOut, receipt, receiptPath, diffReports, newFiles, extraNotes }) {
  return {
    owner: OWNER, repo: REPO, branch: BRANCH,
    slug, baseDir, mode, version, provider, model, raceReport,
    smoke, security, metaJson, resolved, totalCost, totalIn, totalOut,
    receipt, receiptPath, diffReports, newFiles, extraNotes,
  };
}

async function main() {
  const inputs = resolveInputs();
  if (!inputs) { console.log('Comment has no valid tag - ignoring.'); return; }
  const { project, prompt, mode, issue, commentId } = inputs;
  currentIssue = issue;

  await pushProgress({ status: 'running' });
  await step('Parse request', async () => inputs);
  const slug = T.slugify(project);
  if (!slug && mode !== 'evolve' && mode !== 'skills') throw new Error('Project name needs at least one letter or digit');

  const baseDir = `${PROJECTS_DIR}/${slug}`;
  const mainFile = `${baseDir}/index.html`;
  const receiptPath = `${RECEIPTS_DIR}/${slug}.json`;
  const changelogPath = `${baseDir}/CHANGELOG.md`;

  if (commentId) {
    try { await octokit.reactions.createForIssueComment({ owner: OWNER, repo: REPO, comment_id: commentId, content: 'eyes' }); } catch (e) { }
    if (mode !== 'ask' && mode !== 'skill' && mode !== 'skills' && mode !== 'evolve' && mode !== 'leaderboard') { try { await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'open' }); } catch { } }
  }
  const quoted = prompt ? `\n> ${prompt.slice(0, 200).replace(/\n/g, ' ')}` : '';
  const header =
    mode === 'ask'         ? `🔎 **Searching the repo…**${quoted}` :
    mode === 'leaderboard' ? `📊 **Loading analytics…**` :
    mode === 'skills'      ? `🧠 **Loading skill library…**` :
    mode === 'revert'      ? `↩️ **Handling revert for \`${slug || '?'}\`**${quoted}` :
                             `⏳ **Working on it** — \`${mode}\` on \`${slug || 'system'}\`${quoted}`;
  await startStatusComment(issue, header);

  if (mode === 'ask') return runAsk(inputs);
  if (mode === 'leaderboard') return runLeaderboard(issue);
  if (mode === 'skills') return runSkills(issue);

  if (mode === 'skill') {
    const skillName = prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const r = await step('Generate Skill Cheatsheet', () => askAI([{ role: 'system', content: SKILL_RULES }, { role: 'user', content: prompt }]));
    const filePath = `knowledge/skills/${skillName}.md`;
    await atomicCommit({ [filePath]: r.text }, [], `docs: add skill ${skillName}`);
    await syncCheckout();
    await finishStatus(issue, `🧠 **Skill Learned:** \`${filePath}\``, true);
    await pushProgress({ status: 'done' });
    return;
  }

  if (mode === 'evolve') {
    const parts = prompt.split(' ');
    const targetFile = parts[0];
    const instructions = parts.slice(1).join(' ');
    if (!targetFile || !targetFile.includes('.')) throw new Error('Usage: [evolve] <filename> <instructions>.');
    const original = await readFile(targetFile);
    if (!original) throw new Error(`Target file not found: ${targetFile}`);
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
    await step('Validate Evolve Output', async () => {
      const tempName = `.evolve-tmp-${Date.now()}.js`;
      fs.writeFileSync(tempName, newCode);
      try {
        try { execSync(`node -c ${tempName}`, { stdio: 'pipe' }); }
        catch (e) { throw new Error(`Invalid JS syntax. Blocked. ${(e.stderr || '').toString().slice(0, 400)}`); }
        const Module = require('module');
        const baseFile = path.resolve(targetFile);
        const basePaths = Module._nodeModulePaths(path.dirname(baseFile));
        const unresolved = [];
        let m;
        const re = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((m = re.exec(newCode))) {
          const spec = m[1];
          if (!spec.startsWith('.')) continue;
          try { Module._resolveFilename(spec, { filename: baseFile, paths: basePaths }); }
          catch (e) { unresolved.push(`${spec} (${e.code || 'UNRESOLVED'})`); }
        }
        if (unresolved.length) throw new Error(`Unresolved relative require(s) in ${targetFile}: ${unresolved.join(', ')}. Blocked.`);
      } finally { try { fs.unlinkSync(tempName); } catch { } }
    });
    await step(`Commit ${targetFile}`, () => atomicCommit({ [targetFile]: newCode }, [], `feat(evolve): modify ${targetFile}`));
    await syncCheckout();
    await finishStatus(issue, `🧬 **Evolution Successful.** \`${targetFile}\` updated (syntax + require resolution verified).`, true);
    await pushProgress({ status: 'done' });
    return;
  }

  let manifest = [];
  try { const raw = await readFile(MANIFEST_PATH); if (raw) manifest = JSON.parse(raw); if (!Array.isArray(manifest)) manifest = []; } catch { manifest = []; }

  if (mode === 'revert') {
    const targetVersion = (prompt || '').trim().replace(/^v/i, '');
    if (!targetVersion) {
      const versions = await step('Reading version history', () => listVersions(slug));
      if (!versions.length) { await finishStatus(issue, `📜 No history for \`${slug}\`.`, true); await pushProgress({ status: 'done' }); return; }
      const rows = versions.slice(0, 10).map(v => `| v${v.version} | ${formatDate(v.when)} | \`${v.commit}\` | ${v.mode}${v.revertedFrom ? ` (from v${v.revertedFrom})` : ''} |`).join('\n');
      const previousVersion = versions[1] ? versions[1].version : null;
      const hintLine = previousVersion
        ? `Reply with \`[revert] <version>\` to roll back, e.g. \`[revert] ${previousVersion}\`.`
        : `_Only one version exists so far — nothing to revert to yet. Run an \`[improve]\` first._`;
      const body = `📜 **\`${slug}\` — version history**\n\n| Version | When (UTC) | Commit | Mode |\n|---|---|---|---|\n${rows}\n\n${hintLine}`;
      await finishStatus(issue, body + HINT, false); await pushProgress({ status: 'done' }); return;
    }
    const currentMeta = JSON.parse(await readFile(`${baseDir}/meta.json`) || '{}');
    if (!currentMeta.version) throw new Error(`Cannot revert: \`${slug}\` has no meta.json.`);
    if (currentMeta.version === targetVersion) throw new Error(`Already at v${targetVersion} — nothing to revert.`);
    const target = await step(`Locating v${targetVersion}`, () => findVersion(slug, targetVersion));
    if (!target) throw new Error(`Version v${targetVersion} not found for \`${slug}\`.`);
    if (!target.receipt || !target.receipt.files) throw new Error(`Receipt for v${targetVersion} is missing.`);

    const currentSnapshot = {
      'index.html': await readFile(`${baseDir}/index.html`) || '',
      'style.css': await readFile(`${baseDir}/style.css`) || '',
      'script.js': await readFile(`${baseDir}/script.js`) || '',
    };

    const revertedFiles = await step(`Fetching files from v${targetVersion}`, async () => {
      const files = {};
      for (const name of Object.keys(target.receipt.files)) {
        const content = await readFileAtRef(`${baseDir}/${name}`, target.commitSha);
        if (content !== null) files[name] = content;
      }
      return files;
    });
    if (!revertedFiles['index.html']) throw new Error(`v${targetVersion} has no index.html.`);

    const diffReports = Rep.buildChangeReport(currentSnapshot, revertedFiles, false);
    const newVersion = bumpVersion(currentMeta.version);
    const oldMeta = JSON.parse(revertedFiles['meta.json'] || '{}');
    oldMeta.version = newVersion;
    oldMeta.revertedFrom = targetVersion;
    oldMeta.revertedAt = new Date().toISOString();
    revertedFiles['meta.json'] = JSON.stringify(oldMeta, null, 2);

    const receipt = R.buildReceipt({
      repo: `${OWNER}/${REPO}`, slug, files: revertedFiles, mode: 'revert',
      runId: RUN_ID, commit: null, provider: 'revert', model: `from-v${targetVersion}`,
      race: [], smoke: { ok: true, errors: [], skipped: true },
      security: { total: 0, high: 0, medium: 0, low: 0, byTool: {} },
      prompt: `revert to v${targetVersion}`, vanilla: T.isVanilla(revertedFiles['index.html'] || '', TRUSTED_DOMAINS).ok,
    });
    revertedFiles[receiptPath] = JSON.stringify(receipt, null, 2) + '\n';

    const oldChangelog = await readFile(changelogPath) || '';
    const newChangelog = Rep.buildChangelogEntry({
      version: newVersion, mode: 'revert', when: new Date().toISOString(),
      provider: 'revert', model: `from-v${targetVersion}`, totalCost: 0,
      diffReports, metaJson: { features: [], fixes: [], suggestions: [], humanInvolvement: 'None' },
      oldChangelog, isNew: false,
      extraNotes: `**Reverted to content of v${targetVersion}** (\`${target.commit}\`, ${formatDate(target.when)}).`,
    });
    revertedFiles['CHANGELOG.md'] = newChangelog;

    const fullFiles = {};
    for (const [name, content] of Object.entries(revertedFiles)) {
      if (name === receiptPath) fullFiles[name] = content;
      else fullFiles[`${baseDir}/${name}`] = content;
    }
    const commitSha = await step(`Commit revert v${currentMeta.version} → v${newVersion}`, () =>
      atomicCommit(fullFiles, [], `revert: ${slug} to v${targetVersion} (as v${newVersion})`));
    receipt.commit = commitSha;
    revertedFiles[receiptPath] = JSON.stringify(receipt, null, 2) + '\n';

    const commitSha2 = await atomicCommit({ [receiptPath]: revertedFiles[receiptPath] }, [], `chore: receipt ${slug}`);
    await syncCheckout();

    const body = Rep.buildSummaryComment(reportCtx({
      slug, baseDir, mode: 'revert', version: newVersion,
      provider: 'revert', model: `from-v${targetVersion}`, raceReport: [],
      smoke: { ok: true, errors: [], skipped: true },
      security: { findings: [], counts: { total: 0, high: 0, medium: 0, low: 0, byTool: {} } },
      metaJson: { features: [], fixes: [], suggestions: [], humanInvolvement: 'None' },
      resolved: { discovered: [] },
      totalCost: 0, totalIn: 0, totalOut: 0,
      receipt, receiptPath, diffReports, newFiles: revertedFiles,
      extraNotes: `Restored content of **v${targetVersion}** (\`${target.commit}\`).`,
    }));
    await finishStatus(issue, body + HINT, true);

    const isDeployed = await waitForPagesBuild(commitSha2);
    if (isDeployed && issue) {
      const url = `https://${OWNER}.github.io/${REPO}/${baseDir}/`;
      const shot = `### 📸 Live Preview\n\n[![${slug} screenshot](https://image.thum.io/get/width/1200/crop/900/${url}?t=${Date.now()})](${url})\n\n_Click to open_`;
      await appendToStatus(issue, shot);
    }
    await pushProgress({ status: 'done' });
    return;
  }

  if (mode === 'delete') {
    const filesToDelete = [];
    for (const f of ['index.html', 'style.css', 'script.js', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'meta.json', 'CHANGELOG.md']) {
      const p = `${baseDir}/${f}`;
      if ((await readFile(p)) !== null) filesToDelete.push(p);
    }
    if ((await readFile(receiptPath)) !== null) filesToDelete.push(receiptPath);
    const existed = filesToDelete.length > 0;
    manifest = manifest.filter((e) => e.project !== slug);
    await atomicCommit({ [MANIFEST_PATH]: JSON.stringify(manifest, null, 2) + '\n' }, filesToDelete, `chore: delete ${slug}`);
    await syncCheckout();
    await finishStatus(issue, existed ? `🗑 Deleted \`${slug}\` (${filesToDelete.length} files).` : `\`${slug}\` did not exist.`, true);
    await pushProgress({ status: 'done' }); return;
  }

  let existingHtml = await readFile(mainFile);
  let existingCss = await readFile(`${baseDir}/style.css`) || '';
  let existingJs = await readFile(`${baseDir}/script.js`) || '';
  const isNew = !existingHtml;

  const oldForDiff = {
    'index.html': existingHtml || '',
    'style.css': existingCss,
    'script.js': existingJs,
  };

  if ((mode === 'improve' || mode === 'fix' || mode === 'audit') && !existingHtml) throw new Error(`Cannot ${mode} "${slug}": no existing file.`);

  let ask;
  if (mode === 'create' || (!existingHtml && mode !== 'fix' && mode !== 'audit')) ask = prompt;
  else if (mode === 'improve') ask = 'Improve the existing app. Keep what works and apply: ' + prompt;
  else if (mode === 'fix') ask = `Fix ONLY the bug or issues described.\n\nBUG: ${prompt || 'see scanner findings'}`;
  else if (mode === 'audit') {
    let combined = existingHtml.replace('</head>', `<style>${existingCss}</style></head>`).replace('</body>', `<script>${existingJs}</script></body>`);
    const initial = await step('Initial security scan', () => runAllScanners(combined, { trustedDomains: TRUSTED_DOMAINS }));
    if (!initial.findings.length && !prompt) { await finishStatus(issue, '✅ Audit clean.', true); await pushProgress({ status: 'done' }); return; }
    const report = initial.findings.length ? initial.findings.map((f) => `- [${f.sev}] ${f.msg}`).join('\n') : '(none)';
    ask = `Fix the security issues.\n\nFINDINGS:\n${report}\n\nEXTRA: ${prompt || 'none'}`;
  }

  let inspirationCtx = '';
  if (mode === 'inspire') {
    const searchRes = await step(`Searching GitHub for "${prompt.slice(0, 60)}…"`, () => searchGitHubForInspiration(prompt));
    if (searchRes.inspiration) {
      inspirationCtx = `\n\nHere are some highly successful open-source apps for inspiration. Extract their best UI/UX patterns and logic, but write the code entirely from scratch:\n${searchRes.inspiration}`;
      ask = `Build a brand new app based on this idea: ${prompt}. Use the provided inspiration code as a style and feature guide, but DO NOT copy it verbatim. Make it better.`;
    } else ask = prompt;
  }

  let scrapedContext = '';
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
  if (urlMatch && (mode === 'create' || mode === 'inspire')) {
    const targetUrl = urlMatch[0];
    const scraped = await softStep(`Scrape ${new URL(targetUrl).hostname}`, () => scrapeUrl(targetUrl));
    if (scraped) {
      scrapedContext = `\n\n--- SCRAPED REFERENCE FROM ${targetUrl} ---\n${scraped}\n--- END SCRAPED REFERENCE ---`;
    }
  }

  let skillCtx = '';
  if (mode === 'create' || mode === 'improve' || mode === 'fix' || mode === 'inspire') {
    const sk = await softStep('Match skills (BM25)', async () => skillContext(`${slug} ${prompt}`));
    if (sk && sk.text) { skillCtx = sk.text; const st = steps[steps.length - 1]; if (st) st.note = sk.files.join(', '); }
  }
  let fullPrompt = RULES + LIB_PROMPT + ask + inspirationCtx + scrapedContext + skillCtx;
  if (existingHtml) {
    let eHtml = existingHtml, eCss = existingCss, eJs = existingJs;
    if (eHtml.length > EXISTING_LIMIT) eHtml = eHtml.slice(0, EXISTING_LIMIT);
    if (eCss.length > CSS_JS_LIMIT) eCss = eCss.slice(0, CSS_JS_LIMIT);
    if (eJs.length > CSS_JS_LIMIT) eJs = eJs.slice(0, CSS_JS_LIMIT);
    fullPrompt += `\n\nCURRENT FILES:\n[index.html]:\n${eHtml}\n\n[style.css]:\n${eCss}\n\n[script.js]:\n${eJs}`;
  }

  let cand = await step('Generate with AI (model race)', () => generate(fullPrompt), { promptChars: fullPrompt.length });
  let raceReport = cand.race.slice();

  if (structurallyBad(cand)) {
    currentDraft = cand.grade.html; await pushProgress({}, true);
    const v = T.isVanilla(cand.grade.html, TRUSTED_DOMAINS);
    const why = !T.isUsable(cand.grade.html)
      ? 'it was cut off or malformed. Reply with ONLY the JSON object {"files": {"index.html": "...", "style.css": "...", "script.js": "..."}}.'
      : `it used a forbidden pattern (${v.hit}). Follow the library rules exactly.`;
    cand = await step('Retry (rejected output)', () => generate(`Previous attempt was rejected: ${why}\n\n` + fullPrompt));
    raceReport = raceReport.concat(cand.race);
    if (structurallyBad(cand)) throw new Error(`Still rejected after retry (${cand.grade.reason || 'invalid output'})`);
  }

  let files = cand.grade.files;
  for (const [k, v] of Object.entries(files)) {
    if (typeof v !== 'string') files[k] = Array.isArray(v) ? v.join('\n') : String(v);
  }
  let testHtml = cand.grade.html;
  let smoke = cand.grade.smoke;
  let meta = cand.grade.meta;
  let provider = cand.provider; let model = cand.model;

  steps.push({ name: 'Smoke test', status: smoke.ok ? 'done' : 'error', at: new Date().toISOString(), note: 'ran during race', error: smoke.ok ? undefined : `${smoke.errors.length} runtime error(s)` });
  await pushProgress();

  let attempt = 1;
  while (!smoke.ok && attempt <= 3 && testHtml.length <= EXISTING_LIMIT) {
    const repairPrompt = `${RULES}${LIB_PROMPT}Fix the runtime errors in this app. Keep everything else exactly as it is.\n\nRUNTIME ERRORS:\n${smoke.errors.map((e) => '- ' + e).join('\n')}\n\nCURRENT HTML:\n${testHtml}`;
    const baseline = cand.grade.score;
    const fixed = await softStep(`Repair attempt ${attempt}`, async () => {
      const r = await generate(repairPrompt);
      raceReport = raceReport.concat(r.race);
      if (structurallyBad(r) || r.grade.score <= baseline) throw new Error('repair did not improve');
      return r;
    });
    if (fixed) {
      cand = fixed; files = fixed.grade.files; testHtml = fixed.grade.html; smoke = fixed.grade.smoke; meta = fixed.grade.meta; provider = fixed.provider; model = fixed.model;
      if (smoke.ok) break;
    }
    attempt++;
  }

  const security = await step('Security scan', () => runAllScanners(testHtml, { trustedDomains: TRUSTED_DOMAINS }));

  let score = 100;
  if (!smoke.ok) score -= 30;
  if (smoke.errors.length > 0) score -= Math.min(smoke.errors.length * 5, 20);
  if (security.counts.high > 0) score -= 20;
  if (security.counts.medium > 0) score -= 10;
  if (testHtml.length > 50000) score -= 5;

  if (score < 50) {
    const report = `❌ **Build Failed: Score too low (${score}/100)**`;
    const errors = smoke.errors.length ? `\n**Runtime Errors:**\n${smoke.errors.map(e => `- ${e}`).join('\n')}` : '';
    const secs = security.findings.length ? `\n**Security Issues:**\n${security.findings.map(f => `- [${f.sev}] ${f.msg}`).join('\n')}` : '';
    await finishStatus(issue, report + errors + secs + '\n\nThe broken code was **not** committed.', false);
    await pushProgress({ status: 'error' });
    process.exit(1);
  }

  let resolved;
  try {
    resolved = await Lib.resolveHtml(files['index.html']);
  } catch (e) {
    await finishStatus(issue, `❌ **Library verification failed:**\n\n\`\`\`\n${e.message}\n\`\`\`\n\nFix: if the CDN is intentional, add its host to \`trusted_domains.json\`. If it's a hallucinated URL, retry with an approved library.`, false);
    await pushProgress({ status: 'error' });
    process.exit(1);
  }
  if (resolved.discovered.length) {
    for (const d of resolved.discovered) console.log(`[libraries] discovered ${d.url} (${d.bytes}B)`);
  }
  files['index.html'] = resolved.html;

  let currentHtml = files['index.html'];
  if (!currentHtml.includes('Built by Ariotica')) {
    const watermark = `\n<!-- Built by Ariotica AI -->\n<div style="position:fixed;bottom:12px;right:12px;opacity:0.35;font-size:11px;font-family:monospace;color:white;pointer-events:none;z-index:9999;">⚡ Ariotica</div>`;
    currentHtml = currentHtml.replace(/<\/body>/i, `${watermark}\n</body>`);
  }

  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${resolved.csp}">`;
  if (/http-equiv=["']Content-Security-Policy["']/i.test(currentHtml)) {
    currentHtml = currentHtml.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i, cspTag);
  } else {
    currentHtml = currentHtml.replace('<head>', `<head>\n  ${cspTag}`);
  }

  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash % 360);
  const color = `hsl(${hue}, 70%, 50%)`;
  const letter = slug.charAt(0).toUpperCase();

  const aiLogoBase64 = await softStep('Generate AI Logo', () => fetchAILogo(slug, meta.features));

  if (aiLogoBase64) {
    files['icon-192.png'] = aiLogoBase64;
    files['icon-512.png'] = aiLogoBase64;
    console.log(`[logo] AI logo injected.`);
  } else {
    const hsl = { h: hue, s: 0.70, l: 0.50 };
    files['icon-192.png'] = makeIconPNG(192, hsl).toString('base64');
    files['icon-512.png'] = makeIconPNG(512, hsl).toString('base64');
  }

  const manifestPwa = {
    name: slug.replace(/-/g, ' ').toUpperCase(), short_name: slug, start_url: ".",
    display: "standalone", background_color: "#0b1410", theme_color: color,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230b1410'/><text x='50%' y='55%' font-size='60' fill='${encodeURIComponent(color)}' font-family='system-ui' font-weight='bold' text-anchor='middle' dominant-baseline='middle'>${letter}</text></svg>`, sizes: 'any', type: 'image/svg+xml' }
    ]
  };
  files['manifest.json'] = JSON.stringify(manifestPwa, null, 2);

  if (!currentHtml.includes('rel="manifest"')) {
    currentHtml = currentHtml.replace('</head>', `  <link rel="manifest" href="manifest.json">\n  <link rel="icon" type="image/png" href="icon-192.png">\n  <link rel="apple-touch-icon" href="icon-192.png">\n  <meta name="theme-color" content="${color}">\n</head>`);
  }
  if (!currentHtml.includes('serviceWorker.register')) {
    currentHtml = currentHtml.replace('</body>', `<script>if('serviceWorker' in navigator){addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})})}</script>\n</body>`);
  }
  files['index.html'] = currentHtml;

  const staticHash = (() => {
    const h = crypto.createHash('sha256');
    for (const name of ['index.html', 'style.css', 'script.js', 'manifest.json'].sort()) {
      if (!files[name]) continue;
      h.update(name); h.update('\0'); h.update(files[name]); h.update('\0');
    }
    return h.digest('hex');
  })();
  const precache = ['./', './index.html'];
  if (files['style.css']) precache.push('./style.css');
  if (files['script.js']) precache.push('./script.js');
  if (files['manifest.json']) precache.push('./manifest.json');
  if (files['icon-192.png']) precache.push('./icon-192.png');
  if (files['icon-512.png']) precache.push('./icon-512.png');
  const cacheName = `app-${slug}-${staticHash.slice(0, 8)}`;
  files['sw.js'] = `/* Ariotica SW · ${cacheName} */
const CACHE = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); return res; }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))); return;
  }
  e.respondWith(caches.match(req).then((cached) => { const network = fetch(req).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {}); return res; }).catch(() => cached); return cached || network; }));
});
`;

  let grade = 'F';
  if (score >= 90) grade = 'A+';
  else if (score >= 80) grade = 'A';
  else if (score >= 70) grade = 'B';
  else if (score >= 60) grade = 'C';

  let version = '1.0.0';
  if (meta.version) version = meta.version;
  else if (!isNew) {
    try {
      const oldMeta = JSON.parse(await readFile(`${baseDir}/meta.json`) || '{}');
      if (oldMeta.version) { const parts = oldMeta.version.split('.').map(Number); parts[2] += 1; version = parts.join('.'); }
    } catch {}
  }

  const metaJson = {
    version, features: Array.isArray(meta.features) ? meta.features : [],
    fixes: Array.isArray(meta.fixes) ? meta.fixes : [], suggestions: Array.isArray(meta.suggestions) ? meta.suggestions : [],
    grade, percentile: score >= 90 ? 'Top 5%' : score >= 80 ? 'Top 20%' : 'Top 50%',
    humanInvolvement: meta.humanInvolvement || 'None', libraries: Array.isArray(meta.libraries) ? meta.libraries : ['None'],
    _watermark: "⚡ Built by Ariotica AI"
  };
  files['meta.json'] = JSON.stringify(metaJson, null, 2);

  const diffReports = isNew ? [] : Rep.buildChangeReport(oldForDiff, files, false);
  const oldChangelog = await readFile(changelogPath) || '';
  files['CHANGELOG.md'] = Rep.buildChangelogEntry({
    version, mode, when: new Date().toISOString(),
    provider, model, totalCost: 0,
    diffReports, metaJson, oldChangelog, isNew,
  });

  const receipt = R.buildReceipt({ repo: `${OWNER}/${REPO}`, slug, files, mode, runId: RUN_ID, commit: null, provider, model, race: raceReport, smoke, security: security.counts, prompt, vanilla: T.isVanilla(testHtml, TRUSTED_DOMAINS).ok });
  files[receiptPath] = JSON.stringify(receipt, null, 2) + '\n';

  const idx = manifest.findIndex((e) => e.project === slug);
  const entry = {
    project: slug, file: mainFile, prompt: prompt.slice(0, 240), created: new Date().toISOString().slice(0, 19), mode, provider, model,
    findings: security.counts.total, smoke: smoke.ok ? 'pass' : `fail:${smoke.errors.length}`, size: Object.values(files).reduce((a, b) => a + b.length, 0),
    version, features: metaJson.features, fixes: metaJson.fixes, suggestions: metaJson.suggestions,
    grade, percentile: metaJson.percentile, humanInvolvement: metaJson.humanInvolvement, libraries: metaJson.libraries,
    sha256: receipt.sha256, receipt: receiptPath
  };
  if (idx === -1) manifest.push(entry); else manifest[idx] = Object.assign({}, manifest[idx], entry);
  files[MANIFEST_PATH] = JSON.stringify(manifest, null, 2) + '\n';

  const fullFiles = {};
  for (const [filename, content] of Object.entries(files)) {
    if (filename === MANIFEST_PATH || filename === receiptPath) fullFiles[filename] = content;
    else fullFiles[`${baseDir}/${filename}`] = content;
  }
  if (resolved.cacheChanged) {
    fullFiles['libraries_cache.json'] = JSON.stringify(resolved.cache, null, 2) + '\n';
  }

  const commitSha = await step(`Commit files to ${baseDir}/`, () => atomicCommit(fullFiles, [], `feat: ${slug} v${version} (${mode})`));

  const totalCost = raceReport.reduce((s, r) => s + (r.cost || 0), 0);
  const totalIn   = raceReport.reduce((s, r) => s + (r.tokensIn || 0), 0);
  const totalOut  = raceReport.reduce((s, r) => s + (r.tokensOut || 0), 0);

  files['CHANGELOG.md'] = Rep.buildChangelogEntry({
    version, mode, when: new Date().toISOString(),
    provider, model, totalCost,
    diffReports, metaJson, oldChangelog, isNew,
  });

  const costEntry = {
    ts: new Date().toISOString(), slug, mode, provider, model, runId: RUN_ID,
    cost: totalCost, tokensIn: totalIn, tokensOut: totalOut, score, sec: cand.sec || null,
    race: raceReport.map(r => ({
      provider: r.provider, model: r.model, sec: r.sec, ok: r.ok, score: r.score,
      reason: r.reason, cost: r.cost || 0, tokensIn: r.tokensIn || 0, tokensOut: r.tokensOut || 0,
    })),
  };

  let costs = [];
  try { const raw = await readFile(COSTS_PATH); if (raw) costs = JSON.parse(raw); if (!Array.isArray(costs)) costs = []; } catch { costs = []; }
  costs.push(costEntry);
  if (costs.length > COSTS_LIMIT) costs = costs.slice(-COSTS_LIMIT);
  const leaderboard = rebuildLeaderboard(costs);

  receipt.commit = commitSha;
  receipt.cost = totalCost;
  receipt.tokensIn = totalIn;
  receipt.tokensOut = totalOut;
  files[receiptPath] = JSON.stringify(receipt, null, 2) + '\n';

  const commitSha2 = await atomicCommit({
    [receiptPath]: files[receiptPath],
    [`${baseDir}/CHANGELOG.md`]: files['CHANGELOG.md'],
    [COSTS_PATH]: JSON.stringify(costs, null, 2) + '\n',
    [LB_PATH]: JSON.stringify(leaderboard, null, 2) + '\n',
  }, [], `chore: receipt + changelog + analytics ${slug}`);

  await syncCheckout();

  const body = Rep.buildSummaryComment(reportCtx({
    slug, baseDir, mode, version, provider, model, raceReport,
    smoke, security, metaJson, resolved, totalCost, totalIn, totalOut,
    receipt, receiptPath, diffReports, newFiles: files,
  }));

  await finishStatus(issue, body + HINT, false);

  const isDeployed = await waitForPagesBuild(commitSha2);
  if (isDeployed && issue) {
    const url = `https://${OWNER}.github.io/${REPO}/${baseDir}/`;
    const shot = `### 📸 Live Preview\n\n[![${slug} screenshot](https://image.thum.io/get/width/1200/crop/900/${url}?t=${Date.now()})](${url})\n\n_Screenshot refreshes each build · click to open_`;
    await appendToStatus(issue, shot);
  }

  if (issue) { try { await octokit.issues.update({ owner: OWNER, repo: REPO, issue_number: issue, state: 'closed' }); } catch {} }

  await pushProgress({ status: 'done', securitySummary: security.counts, smoke: smoke.ok ? 'pass' : 'fail', sha256: receipt.sha256, cost: totalCost });
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