'use strict';
// Static scanners for generated apps: custom patterns + ESLint (+ sparrow-sast when installed).

function customAudit(html) {
  const findings = [];
  if (/\.innerHTML\s*=\s*(?!['"`])/.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'innerHTML from variable' });
  if (/\beval\s*\(/.test(html) || /\bnew\s+Function\s*\(/.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'eval/Function' });
  if (/document\.write\s*\(/.test(html)) findings.push({ sev: 'medium', type: 'custom', msg: 'document.write()' });
  const inline = html.match(/on\w+\s*=\s*["'][^"']*["']/gi) || [];
  if (inline.filter((h) => /eval|Function|innerHTML/i.test(h)).length) findings.push({ sev: 'medium', type: 'custom', msg: 'suspicious inline handler' });
  if (/(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i.test(html)) findings.push({ sev: 'high', type: 'custom', msg: 'hardcoded secret' });
  if (/<form[^>]+action\s*=\s*["']https?:\/\//i.test(html)) findings.push({ sev: 'medium', type: 'custom', msg: 'external form action' });
  if (/target\s*=\s*["']_blank["'](?![^>]*rel\s*=\s*["'][^"']*noopener)/i.test(html)) findings.push({ sev: 'low', type: 'custom', msg: 'no rel=noopener' });
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

async function runAllScanners(html) {
  const custom = customAudit(html);
  let eslint = [], sparrow = [];
  try { eslint = await eslintAudit(html); } catch { }
  try { sparrow = await sparrowAudit(html); } catch { }
  const seen = new Set();
  const findings = [];
  for (const f of [...custom, ...eslint, ...sparrow]) {
    const k = f.type + ':' + f.msg.slice(0, 80);
    if (!seen.has(k)) { seen.add(k); findings.push(f); }
  }
  const count = (s) => findings.filter((f) => f.sev === s).length;
  return {
    findings,
    counts: { total: findings.length, high: count('high'), medium: count('medium'), low: count('low'), byTool: { custom: custom.length, eslint: eslint.length, sparrow: sparrow.length } },
  };
}

module.exports = { customAudit, eslintAudit, sparrowAudit, runAllScanners };