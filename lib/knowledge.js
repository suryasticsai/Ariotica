'use strict';
const fs = require('fs');
const path = require('path');
const Rag = require('./rag');

const INCLUDE_EXT = new Set(['.js', '.html', '.json', '.md', '.yml', '.yaml', '.txt', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'knowledge']);
const SKIP_FILES = new Set(['progress.json', 'package-lock.json']);
const MAX_FILE_CHARS = 80000;

function walk(dir, root, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
}

function projectChunks(json) {
  let list;
  try { list = JSON.parse(json); } catch { return Rag.chunkText('projects.json', json); }
  if (!Array.isArray(list)) return [];
  return list.map((e) => ({
    path: 'projects.json', start: 0, end: 0,
    text: `Project ${e.project}: ${e.mode || 'create'} via ${e.provider || 'unknown'} on ${e.created || 'unknown date'}; ` +
          `file ${e.file}; ${e.size ? Math.round(e.size / 1024) + ' KB; ' : ''}${e.findings || 0} scanner findings. Request: ${e.prompt || ''}`,
  }));
}

function collectRepoChunks(root, opts) {
  opts = opts || {};
  const removed = new Set(opts.removed || []);
  const files = [];
  walk(root, root, files);
  const texts = new Map();
  for (const f of files) {
    if (SKIP_FILES.has(f) || removed.has(f) || !INCLUDE_EXT.has(path.extname(f))) continue;
    try { texts.set(f, fs.readFileSync(path.join(root, f), 'utf8')); } catch { }
  }
  for (const [f, txt] of Object.entries(opts.overrides || {})) texts.set(f, txt);
  const chunks = [];
  for (const [f, txt] of texts) {
    if (f === 'projects.json') chunks.push(...projectChunks(txt));
    else chunks.push(...Rag.chunkText(f, txt.slice(0, MAX_FILE_CHARS)));
  }
  chunks.push(...collectSkillChunks(root));
  return chunks;
}

function parseFrontMatter(md) {
  if (!md.startsWith('---')) return { meta: {}, body: md };
  const end = md.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: md };
  const metaRaw = md.slice(3, end).trim();
  const meta = {};
  for (const line of metaRaw.split('\n')) {
    const [k, ...v] = line.split(':');
    if (k && v.length) meta[k.trim()] = v.join(':').trim();
  }
  return { meta, body: md.slice(end + 4).trim() };
}

function collectSkillChunks(root) {
  const dir = path.join(root, 'knowledge', 'skills');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { return []; }
  const out = [];
  for (const n of names) {
    try {
      const raw = fs.readFileSync(path.join(dir, n), 'utf8').slice(0, MAX_FILE_CHARS);
      const { meta, body } = parseFrontMatter(raw);
      const status = meta.status || 'draft';
      const skillName = n.replace('.md', '');
      
      const chunks = Rag.chunkText(`knowledge/skills/${n}`, body, { maxChars: 2200, overlap: 2 });
      for (const c of chunks) {
        c.skill = skillName;
        c.status = status;
        out.push(c);
      }
    } catch { }
  }
  return out;
}

function cleanComment(body) {
  return String(body || '').replace(/<details>[\s\S]*?<\/details>/g, '').replace(/💬 Reply to this issue[^\n]*/g, '').trim();
}

async function collectIssueChunks(octokit, owner, repo, limit) {
  const chunks = [];
  try {
    const issues = await octokit.issues.listForRepo({ owner, repo, state: 'all', per_page: limit || 60, sort: 'updated' });
    for (const it of issues.data) {
      if (it.pull_request) continue;
      chunks.push({ path: `issue#${it.number}`, start: 0, end: 0, text: `Issue #${it.number} (${it.state}): ${it.title}\n${String(it.body || '').slice(0, 1200)}` });
    }
    const cm = await octokit.issues.listCommentsForRepo({ owner, repo, per_page: 100, sort: 'created', direction: 'desc' });
    for (const c of cm.data) {
      const num = String(c.issue_url || '').split('/').pop();
      const body = cleanComment(c.body).slice(0, 900);
      if (body) chunks.push({ path: `issue#${num}`, start: 0, end: 0, text: `Comment on #${num} by ${c.user && c.user.login}: ${body}` });
    }
  } catch (e) { console.log('[knowledge] issue history skipped:', e.message); }
  return chunks;
}

function buildIndexObject(chunks) {
  return { version: 1, built: new Date().toISOString(), count: chunks.length, chunks: chunks.map((c, id) => Object.assign({ id }, c)) };
}

module.exports = { collectRepoChunks, collectSkillChunks, collectIssueChunks, buildIndexObject, cleanComment, parseFrontMatter };