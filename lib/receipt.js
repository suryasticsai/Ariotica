'use strict';
const crypto = require('crypto');

function buildReceipt(a) {
  const files = a.files || {};
  const hashes = {};
  let totalBytes = 0;
  const externalRefs = new Set();
  const connectsTo = new Set();

  for (const [name, content] of Object.entries(files)) {
    const isBinary = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(name);
    const buf = isBinary ? Buffer.from(String(content), 'base64') : Buffer.from(String(content), 'utf8');

    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    hashes[name] = hash;
    totalBytes += buf.length;

    const text = buf.toString('utf8');
    const regex = /(?:src|href)=["'](https?:\/\/[^"']+)["']|fetch\(["'](https?:\/\/[^"']+)["']|new WebSocket\(["'](wss?:\/\/[^"']+)["']/g;
    let m;
    while ((m = regex.exec(text))) {
      const url = m[1] || m[2] || m[3];
      if (url) {
        if (m[3]) connectsTo.add(url);
        else externalRefs.add(url);
      }
    }
  }

  const sha256 = hashes['index.html'] || 'missing';
  const zeroDeps = externalRefs.size === 0;
  const smoke = a.smoke ? (a.smoke.ok ? 'pass' : 'fail') : 'skipped';

  const receipt = {
    schema: 2,
    app: a.slug,
    files: hashes,
    bytes: totalBytes,
    builtAt: new Date().toISOString(),
    mode: a.mode,
    repo: a.repo,
    runId: a.runId,
    commit: a.commit || null,
    model: { provider: a.provider, name: a.model },
    race: a.race || [],
    sha256,
    skillsUsed: Array.isArray(a.skillsUsed) ? a.skillsUsed : [],
    checks: {
      complete: !!a.vanilla,
      vanilla: !!a.vanilla,
      externalRefs: Array.from(externalRefs),
      connectsTo: Array.from(connectsTo),
      zeroDeps,
      smoke,
      smokeErrors: a.smoke ? a.smoke.errors : [],
      scan: a.security || { total: 0, high: 0, medium: 0, low: 0 }
    },
    promptSha256: crypto.createHash('sha256').update(String(a.prompt || '')).digest('hex'),
    prompt: String(a.prompt || '').slice(0, 240),
    note: `Written by the Ariotica workflow. Verify with: node verify-receipt.js ${a.slug}`
  };

  return receipt;
}

function verifyReceipt(receipt, files) {
  const expected = receipt.files || {};
  const actual = {};
  let ok = true;
  for (const [name, content] of Object.entries(files)) {
    const isBinary = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(name);
    const buf = isBinary ? Buffer.from(String(content), 'base64') : Buffer.from(String(content), 'utf8');
    actual[name] = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual[name] !== expected[name]) ok = false;
  }
  for (const name of Object.keys(expected)) {
    if (!(name in actual)) ok = false;
  }
  return { ok, expected, actual };
}

module.exports = { buildReceipt, verifyReceipt };