#!/usr/bin/env node
'use strict';
const fs = require('fs');
const R = require('./lib/receipt');

// T3: any file whose bytes we base64-encoded in generate.js must be
// base64-encoded again here so the hash input matches the receipt.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i;

async function load(path, base) {
  if (!base) {
    const raw = fs.readFileSync(path);
    return BINARY_EXT.test(path) ? raw.toString('base64') : raw.toString('utf8');
  }

  const res = await fetch(`${base.replace(/\/$/, '')}/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);

  if (BINARY_EXT.test(path)) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }
  return res.text();
}

(async () => {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--base');
  const base = bi !== -1 ? args[bi + 1] : '';
  const slug = args.find((a, i) => !a.startsWith('--') && i !== bi + 1);
  if (!slug) { console.error('usage: node verify-receipt.js <app> [--base <site-url>]'); process.exit(2); }

  const receipt = JSON.parse(await load(`receipts/${slug}.json`, base));

  const files = {};
  for (const name of Object.keys(receipt.files)) {
    files[name] = await load(`projects/${slug}/${name}`, base);
  }

  const v = R.verifyReceipt(receipt, files);

  console.log(`app:        ${receipt.app}`);
  console.log(`built:      ${receipt.builtAt} by ${receipt.model.provider}${receipt.model.name ? ' / ' + receipt.model.name : ''}`);
  console.log(`checks:     smoke=${receipt.checks.smoke} · zero-deps=${receipt.checks.zeroDeps} · scan findings=${receipt.checks.scan ? receipt.checks.scan.total : 'n/a'}`);
  console.log(`files:      ${Object.keys(receipt.files).length} hashed`);
  console.log(`verified:   ${v.ok ? '✅ ALL FILES MATCH' : '❌ MISMATCH DETECTED'}`);

  if (!v.ok) {
    for (const [name, expected] of Object.entries(v.expected)) {
      if (expected !== v.actual[name]) {
        const isBin = BINARY_EXT.test(name);
        console.log(`  - ${name}${isBin ? ' (binary)' : ''}: expected ${expected}, got ${v.actual[name]}`);
      }
    }
  }

  process.exit(v.ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(2); });