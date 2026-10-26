'use strict';

const TITLE_TAGS = 'create|evolve|inspire|improve|fix|audit|delete|revert|leaderboard|skill|skills';
const COMMENT_TAGS = 'create|evolve|inspire|improve|fix|audit|delete|ask|revert|leaderboard|skill|skills';

// Only build-step / Node-style patterns are absolutely forbidden.
// Library usage is allowed via approved CDN URLs (checked by trustedDomains).
const FORBIDDEN_MODULES = [
  /^\s*import\s+[\w{}*\s,]+\s+from\s+["']/m,
  /\brequire\s*\(\s*["']/,
];

function stripComments(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
}

function isVanilla(html, trustedDomains) {
  const code = stripComments(html);
  const domains = trustedDomains || new Set();

  // 1. Any external <script src> or <link rel=stylesheet href> must be trusted.
  const extRe = /<(?:script|link)\b[^>]*?(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = extRe.exec(code))) {
    const url = m[1];
    let host;
    try { host = new URL(url).hostname.toLowerCase(); }
    catch { return { ok: false, hit: `bad URL: ${url}` }; }
    if (!domains.has(host)) return { ok: false, hit: `untrusted CDN: ${host}` };
  }

  // 2. No import/require — indicates a build step.
  for (const re of FORBIDDEN_MODULES) if (re.test(code)) return { ok: false, hit: String(re) };

  return { ok: true, hit: null };
}

function stripFences(t) {
  t = String(t || '').trim();
  t = t.replace(/^```(?:json|JSON|html|HTML)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const k = t.indexOf('{');
  if (k !== -1 && k < 20 && /"(html|files)"\s*:/.test(t.slice(0, 80))) {
    return t.slice(k);
  }
  const i = t.search(/<!DOCTYPE|<html/i);
  if (i > 0) t = t.slice(i);
  const j = t.lastIndexOf('</html>');
  if (j > 0) t = t.slice(0, j + 7);
  return t.trim();
}

function parseMultiFileResponse(text) {
  let clean = stripFences(text);
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

function isUsable(html) {
  html = String(html || '');
  return /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html) && /<\/html>\s*$/i.test(html) && html.length > 500;
}

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function parseTitle(title) {
  const m = String(title || '').match(new RegExp(`^\\[BUILD\\]\\s+([A-Za-z0-9 _-]+?)(?:\\s*\\[(${TITLE_TAGS})\\])?\\s*$`));
  return m ? { project: m[1].trim(), mode: m[2] ? m[2].toLowerCase() : null } : null;
}

function parseComment(raw) {
  const body = String(raw || '').split('\n').filter((l) => !l.trim().startsWith('>')).join('\n').trim();
  const first = body.match(new RegExp(`^\\[(${COMMENT_TAGS})\\]\\s*([\\s\\S]*)$`, 'i'));
  if (first) return { mode: first[1].toLowerCase(), prompt: first[2].trim() };
  const last = body.match(new RegExp(`^([\\s\\S]*?)\\s*\\[(${COMMENT_TAGS})\\]\\s*$`, 'i'));
  if (last) return { mode: last[2].toLowerCase(), prompt: last[1].trim() };
  return null;
}

module.exports = { FORBIDDEN_MODULES, stripComments, isVanilla, stripFences, isUsable, slugify, parseTitle, parseComment, parseMultiFileResponse };