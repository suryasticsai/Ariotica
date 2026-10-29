'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const lines = [];
let failed = false;

function ok(label, extra) { lines.push(`✅ ${label}${extra ? ` — ${extra}` : ''}`); }
function bad(label, detail) {
  failed = true;
  lines.push(`❌ ${label}${detail ? `\n   \`${String(detail).slice(0, 200)}\`` : ''}`);
}
function section(name) { lines.push(''); lines.push(`### ${name}`); }

function emit() {
  const summary = [
    '# Static Tests',
    '',
    lines.join('\n'),
    '',
    failed ? '## ❌ Some tests failed' : '## ✅ All tests passed',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n'); } catch {}
  }
}

try {
  // ── Layer 0: syntax ─────────────────────────────────────────
  section('Layer 0 — Syntax');
  const files = [
    'generate.js',
    'lib/text.js',
    'lib/libraries.js',
    'lib/scan.js',
    'lib/diff.js',
    'lib/report.js',
    'lib/providers.js',
    'lib/pricing.js',
    'lib/plugin-manager.js', 
    'lib/evolve.js'    
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) { bad(`${f} — missing`); continue; }
    try {
      execSync(`node --check "${f}"`, { stdio: 'pipe' });
      ok(f);
    } catch (e) {
      const err = (e.stderr || '').toString().split('\n')[0] || e.message;
      bad(f, err);
    }
  }

  // ── Layer 1: diff.js ────────────────────────────────────────
  section('Layer 1 — diff.js');
  try {
    const D = require(path.join(ROOT, 'lib/diff'));

    const t1 = D.unified('a\nb\nc', 'a\nb\nc');
    (t1.unchanged && t1.adds === 0 && t1.dels === 0)
      ? ok('identical → unchanged')
      : bad('identical → unchanged', JSON.stringify(t1));

    const t2 = D.unified('a\nb\nc', 'a\nX\nc');
    (t2.adds === 1 && t2.dels === 1 && t2.text.includes('-b') && t2.text.includes('+X'))
      ? ok('single-line change')
      : bad('single-line change', `adds=${t2.adds} dels=${t2.dels}`);

    const t3 = D.unified('a', 'a\nb\nc');
    (t3.adds === 2 && t3.dels === 0)
      ? ok('pure addition')
      : bad('pure addition', `adds=${t3.adds} dels=${t3.dels}`);

    const t4 = D.unified('a\nb\nc', 'a');
    (t4.adds === 0 && t4.dels === 2)
      ? ok('pure deletion')
      : bad('pure deletion', `adds=${t4.adds} dels=${t4.dels}`);
  } catch (e) { bad('diff.js loads', e.message); }

  // ── Layer 2: report.js ──────────────────────────────────────
  section('Layer 2 — report.js');
  try {
    const Rep = require(path.join(ROOT, 'lib/report'));

    const d1 = Rep.buildChangeReport(
      { 'index.html': '<html>old</html>', 'style.css': '', 'script.js': '' },
      { 'index.html': '<html>new</html>', 'style.css': '', 'script.js': '' },
      false
    );
    (d1.length >= 1 && d1[0].name === 'index.html' && d1[0].adds > 0 && d1[0].dels > 0)
      ? ok('detects file changes')
      : bad('detects file changes', `got ${d1.length} report(s)`);

    const d2 = Rep.buildChangeReport(
      { 'index.html': 'same', 'style.css': '', 'script.js': '' },
      { 'index.html': 'same', 'style.css': '', 'script.js': '' },
      false
    );
    (d2.length === 0)
      ? ok('skips unchanged files')
      : bad('skips unchanged files', `got ${d2.length}`);

    const c = Rep.buildSummaryComment({
      owner: 'x', repo: 'y', branch: 'main',
      slug: 'z', baseDir: 'projects/z', mode: 'improve', version: '1.0.1',
      provider: 'p', model: 'm', raceReport: [],
      smoke: { ok: true, errors: [], skipped: false },
      security: { findings: [], counts: { total: 0, high: 0, medium: 0, low: 0, byTool: {} } },
      metaJson: { features: ['x'], fixes: [], suggestions: [] },
      resolved: { discovered: [] },
      totalCost: 0, totalIn: 0, totalOut: 0,
      receipt: { sha256: 'a'.repeat(64) }, receiptPath: 'r.json',
      diffReports: [], newFiles: { 'index.html': 'x' },
    });
    (c.includes('### ✨ What changed') && c.includes('✅'))
      ? ok('renders summary markdown')
      : bad('renders summary markdown');

    const cl = Rep.buildChangelogEntry({
      version: '1.0.1', mode: 'improve', when: new Date().toISOString(),
      provider: 'p', model: 'm', totalCost: 0.001,
      diffReports: [], metaJson: { features: [], fixes: [], suggestions: [] },
      oldChangelog: '# Changelog\n\n## v1.0.0 — old', isNew: false,
    });
    (cl.includes('## v1.0.1') && cl.includes('## v1.0.0'))
      ? ok('changelog prepends new entry')
      : bad('changelog prepends new entry');
  } catch (e) { bad('report.js loads', e.message); }

  // ── Layer 3: libraries.js ───────────────────────────────────
  section('Layer 3 — libraries.js');
  try {
    const Lib = require(path.join(ROOT, 'lib/libraries'));

    const t = Lib.loadTrusted();
    (t.size >= 1)
      ? ok('trusted_domains.json loads', `${t.size} domain(s)`)
      : bad('trusted_domains.json loads');

    const cat = Lib.loadCatalog();
    (Object.keys(cat).length >= 1)
      ? ok('libraries_catalog.json loads', `${Object.keys(cat).length} entry(ies)`)
      : bad('libraries_catalog.json loads');

    // FIXED: Check for external CDNs rather than 'https://' (since Google Fonts is always https)
    const narrow = Lib.buildCsp([], [], []);
    const isNarrow = narrow.includes("connect-src 'self'") && !narrow.includes('cdn.jsdelivr.net') && !narrow.includes('unpkg.com');
    isNarrow
      ? ok('narrow CSP has no external script origins')
      : bad('narrow CSP', narrow);

    const wide = Lib.buildCsp(['https://cdn.jsdelivr.net'], [], []);
    (wide.includes('https://cdn.jsdelivr.net') && /script-src[^;]+cdn\.jsdelivr\.net/.test(wide))
      ? ok('CSP widens for script CDN')
      : bad('CSP widens', wide);

    const peer = Lib.buildCsp(['https://cdn.jsdelivr.net'], [], ['wss://0.peerjs.com']);
    (/connect-src[^;]+wss:\/\/0\.peerjs\.com/.test(peer))
      ? ok('CSP includes wss for peerjs')
      : bad('CSP peerjs connect', peer);
  } catch (e) { bad('libraries.js loads', e.message); }
} catch (e) {
  bad('script crashed', e.message);
} finally {
  emit();
}

process.exit(failed ? 1 : 0);