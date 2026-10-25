'use strict';
// Static scanners for generated apps: custom patterns + ESLint (+ sparrow-sast when installed).
// v1.2 — adds external-CDN trust check; byTool counts now include `externals`.

function customAudit(html) {
  const findings = [];
  if (/\.innerHTML\s*=\s*(?!['"`])/.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'innerHTML from variable' });
  if (/\.insertAdjacentHTML\s*\(/.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'insertAdjacentHTML' });
  if (/\beval\s*\(/.test(html) || /\bnew\s+Function\s*\(/.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'eval/Function' });
  if (/document\.write\s*\(/.test(html)) findings.push({ sev: 'medium', type: 'custom', msg: 'document.write()' });
  if (/\b(?:href|src)\s*=\s*["']\s*javascript:/i.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'javascript: URL' });
  const inline = html.match(/on\w+\s*=\s*["'][^"']*["']/gi) || [];
  if (inline.filter((h) => /eval|Function|innerHTML/i.test(h)).length) findings.push({ sev: 'medium', type: 'custom', msg: 'suspicious inline handler' });
  if (/(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'hardcoded secret' });
  if (/<form[^>]+action\s*=\s*["']https?:\/\//i.test(html)) findings.push({ sev: 'medium', type: 'custom', msg: 'external form action' });
  if (/target\s*=\s*["']_blank["'](?![^>]*rel\s*=\s*["'][^"']*noopener)/i.test(html)) findings.push({ sev: 'low', type: 'custom', msg: 'no rel=noopener' });
  return findings;
}

// ============================================================
// NEW: external CDN trust check
// Any <script src> or <link rel=stylesheet href> pointing at an
// https:// URL whose hostname is NOT in trustedDomains is flagged
// high-severity. SRI is deliberately NOT checked here — Lib.resolveHtml
// injects it after the scan, so flagging its absence would be noise.
// ============================================================
function scanExternalRefs(html, trustedDomains) {
  const findings = [];
  if (!trustedDomains) return findings;

  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/script>/gi)) {
    const url = m[1];
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (!trustedDomains.has(host)) {
        findings.push({ sev: 'high', type: 'externals', msg: `Untrusted script CDN: ${host} (${url})` });
      }
    } catch {
      findings.push({ sev: 'high', type: 'externals', msg: `Bad script URL: ${url}` });
    }
  }

  for (const m of html.matchAll(/<link\b[^>]*?\brel\s*=\s*["']stylesheet["'][^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
    const url = m[1];
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (!trustedDomains.has(host)) {
        findings.push({ sev: 'high', type: 'externals', msg: `Untrusted style CDN: ${host} (${url})` });
      }
    } catch {
      findings.push({ sev: 'high', type: 'externals', msg: `Bad stylesheet URL: ${url}` });
    }
  }

  return findings;
}

async function eslintAudit(html) {
  const findings = [];
  try {
    const { Linter } = require('eslint');
    const linter = new Linter();
    const blocks = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) blocks.push(m[1]);
    if (!blocks.length) return findings;
    const rules = { 'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error', 'no-script-url': 'error', 'no-unused-vars': 'warn', 'no-undef': 'off', 'no-dupe-keys': 'error' };
    let idx = 0;
    for (const code of blocks) {
      idx++;
      const msgs = linter.verify(code, { languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { window: 'readonly', document: 'readonly', console: 'readonly', localStorage: 'readonly' } }, rules });
      for (const msg of msgs) findings.push({ sev: msg.severity === 2 ? 'high' : 'medium', type: 'eslint', msg: `[script#${idx}:${msg.line}] ${msg.message}` });
    }
  } catch (e) { console.log('eslint failed:', e.message); }
  return findings;
}

async function sparrowAudit(html) {
  const findings = [];
  try {
    const fs = require('fs'), path = require('path'), os = require('os');
    let scan;
    try { scan = require('sparrow-sast').scan; } catch { return findings; }
    const tmp = path.join(os.tmpdir(), `ariotica-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    try {
      const issues = await scan(tmp, { useBuiltinCheckers: true, languages: ['javascript', 'html'] });
      for (const issue of issues) findings.push({ sev: issue.severity === 'error' ? 'high' : 'medium', type: 'sparrow', msg: issue.message });
    } finally { fs.unlinkSync(tmp); }
  } catch (e) { console.log('sparrow failed:', e.message); }
  return findings;
}

async function runAllScanners(html, opts) {
  opts = opts || {};
  const custom = customAudit(html);
  const externals = scanExternalRefs(html, opts.trustedDomains);
  let eslint = [], sparrow = [];
  try { eslint = await eslintAudit(html); } catch { }
  try { sparrow = await sparrowAudit(html); } catch { }
  const seen = new Set();
  const findings = [];
  for (const f of [...custom, ...externals, ...eslint, ...sparrow]) {
    const k = (f.type || '') + ':' + f.msg.slice(0, 80);
    if (!seen.has(k)) { seen.add(k); findings.push(f); }
  }
  const count = (s) => findings.filter((f) => f.sev === s).length;
  const countTool = (t) => findings.filter((f) => f.type === t).length;
  return {
    findings,
    counts: {
      total: findings.length,
      high: count('high'),
      medium: count('medium'),
      low: count('low'),
      byTool: {
        custom: countTool('custom'),
        eslint: countTool('eslint'),
        sparrow: countTool('sparrow'),
        externals: countTool('externals'),
      },
    },
  };
}

module.exports = { customAudit, scanExternalRefs, eslintAudit, sparrowAudit, runAllScanners };