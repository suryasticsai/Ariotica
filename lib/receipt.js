'use strict';
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

function externalRefs(content) {
  const patterns = [
    /<(?:script|img|iframe|video|audio|source|embed|object)\b[^>]*?\bsrc\s*=\s*["']((?:https?:)?\/\/[^"']+)/gi,
    /<link\b[^>]*?\bhref\s*=\s*["']((?:https?:)?\/\/[^"']+)/gi,
    /url\(\s*["']?((?:https?:)?\/\/[^)"']+)/gi,
    /@import\s+(?:url\()?\s*["']?((?:https?:)?\/\/[^"')\s;]+)/gi,
  ];
  const found = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) if (!/www\.w3\.org/i.test(m[1])) found.add(m[1]);
  }
  return Array.from(found).slice(0, 20);
}

function buildReceipt(a) {
  const fileHashes = {};
  let totalBytes = 0;
  const refs = new Set();
  
  for (const [name, content] of Object.entries(a.files)) {
    fileHashes[name] = sha256(content);
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (name.endsWith('.html') || name.endsWith('.css')) {
      externalRefs(content).forEach(ref => refs.add(ref));
    }
  }

  const smoke = a.smoke || { skipped: true, ok: true, errors: [] };
  const vanilla = a.vanilla || { ok: true };

  return {
    schema: 1,
    app: a.slug,
    files: fileHashes,
    bytes: totalBytes,
    builtAt: new Date().toISOString(),
    mode: a.mode,
    repo: a.repo,
    runId: a.runId,
    commit: a.commit || null,
    model: { provider: a.provider, name: a.model || null },
    race: (a.race || []).slice(-8),
    sha256: fileHashes['index.html'] || sha256(JSON.stringify(fileHashes)),
    checks: {
      complete: Object.keys(a.files).includes('index.html'),
      vanilla: !!vanilla.ok,
      externalRefs: Array.from(refs),
      zeroDeps: !!vanilla.ok && refs.size === 0,
      smoke: smoke.skipped ? 'skipped' : smoke.ok ? 'pass' : 'fail',
      smokeErrors: (smoke.errors || []).slice(0, 5),
      scan: a.security || null,
    },
    promptSha256: sha256(a.prompt || ''),
    prompt: String(a.prompt || '').slice(0, 240),
    note: 'Written by the Ariotica workflow. Verify with: node verify-receipt.js ' + a.slug,
  };
}

function verifyReceipt(receipt, files) {
  let ok = true;
  const expected = {};
  const actual = {};
  for (const [name, hash] of Object.entries(receipt.files)) {
    expected[name] = hash;
    const content = files[name];
    actual[name] = content !== undefined ? sha256(content) : null;
    if (hash !== actual[name]) ok = false;
  }
  return { ok, expected, actual };
}

module.exports = { sha256, externalRefs, buildReceipt, verifyReceipt };