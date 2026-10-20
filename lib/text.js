'use strict';
// Pure text helpers: no network, no GitHub, fully unit-tested (test/text.test.js).

const TITLE_TAGS = 'improve|fix|audit|delete';
const COMMENT_TAGS = 'improve|fix|audit|delete|ask';

// Only patterns that indicate REAL usage of a library or external resource.
const FORBIDDEN = [
  /<script[^>]+src\s*=\s*["']https?:\/\//i,
  /<link[^>]+href\s*=\s*["']https?:\/\//i,
  /\balpine\.?js\b/i, /\bhtmx\b/i, /\bjquery\b/i,
  /\bbootstrap(\.min)?\.(css|js)\b/i, /cdn\.tailwindcss/i,
  /font-?awesome/i, /unpkg\.com/i, /cdn\.jsdelivr\.net/i, /cdnjs\.cloudflare\.com/i,
  /\bfrom\s+["']react["']/i, /\bReactDOM\b/, /\bnew\s+Vue\s*\(/, /\bcreateApp\s*\(/,
  /^\s*import\s+[\w{}*\s,]+\s+from\s+["']/m, /\brequire\s*\(\s*["']/,
];

function stripComments(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
}

function isVanilla(html) {
  const code = stripComments(html);
  for (const re of FORBIDDEN) if (re.test(code)) return { ok: false, hit: String(re) };
  return { ok: true, hit: null };
}

function stripFences(t) {
  t = String(t || '').trim();
  t = t.replace(/^```(?:json|JSON|html|HTML)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const k = t.indexOf('{');
  if (k !== -1 && k < 20 && /"html"\s*:/.test(t.slice(0, 80))) {
    const body = t.slice(k);
    let extracted = null;
    try {
      const j = JSON.parse(body);
      if (j && typeof j.html === 'string') extracted = j.html;
    } catch {
      const m = body.match(/"html"\s*:\s*"([\s\S]*)"\s*\}?\s*$/);
      if (m) { try { extracted = JSON.parse('"' + m[1].replace(/\r?\n/g, '\\n') + '"'); } catch { /* unsalvageable */ } }
    }
    t = extracted === null ? '' : extracted;
  }
  const i = t.search(/<!DOCTYPE|<html/i);
  if (i > 0) t = t.slice(i);
  const j = t.lastIndexOf('</html>');
  if (j > 0) t = t.slice(0, j + 7);
  return t.trim();
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
  const body = String(raw || '').split('\n').filter((l) => !/^\s*>/.test(l)).join('\n').trim();
  const first = body.match(new RegExp(`^\\[(${COMMENT_TAGS})\\]\\s*([\\s\\S]*)$`, 'i'));
  if (first) return { mode: first[1].toLowerCase(), prompt: first[2].trim() };
  const last = body.match(new RegExp(`^([\\s\\S]*?)\\s*\\[(${COMMENT_TAGS})\\]\\s*$`, 'i'));
  if (last) return { mode: last[2].toLowerCase(), prompt: last[1].trim() };
  return null;
}

// Parses the structured AI response
function parseAIResponse(text) {
  let clean = String(text || '').trim();
  clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  try {
    const data = JSON.parse(clean.slice(start, end + 1));
    return {
      html: data.html || '',
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

module.exports = { FORBIDDEN, stripComments, isVanilla, stripFences, isUsable, slugify, parseTitle, parseComment, parseAIResponse };