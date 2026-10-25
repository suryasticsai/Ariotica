'use strict';

function unified(oldText, newText, opts) {
  opts = opts || {};
  const maxLines = opts.maxLines || 300;
  const ctx = opts.context || 3;

  oldText = String(oldText || '');
  newText = String(newText || '');
  if (oldText === newText) return { text: '', adds: 0, dels: 0, unchanged: true };

  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length, n = b.length;

  // Too large for DP LCS in memory — report stats only
  if (m * n > 2e6) {
    return { text: '', adds: n, dels: m, skipped: 'file too large for inline diff' };
  }

  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    const row = dp[i], prev = dp[i - 1];
    for (let j = 1; j <= n; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : (prev[j] > row[j - 1] ? prev[j] : row[j - 1]);
    }
  }

  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { ops.push({ t: 'ctx', l: a[i - 1] }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.push({ t: 'add', l: b[j - 1] }); j--; }
    else { ops.push({ t: 'del', l: a[i - 1] }); i--; }
  }
  ops.reverse();

  const included = new Set();
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t === 'ctx') continue;
    for (let d = -ctx; d <= ctx; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < ops.length) included.add(idx);
    }
  }

  let adds = 0, dels = 0;
  for (const op of ops) { if (op.t === 'add') adds++; else if (op.t === 'del') dels++; }

  const lines = [];
  let lastIncluded = -2;
  for (let k = 0; k < ops.length; k++) {
    if (!included.has(k)) continue;
    if (k > lastIncluded + 1) lines.push('@@ … @@');
    const op = ops[k];
    const prefix = op.t === 'add' ? '+' : op.t === 'del' ? '-' : ' ';
    lines.push(prefix + op.l);
    lastIncluded = k;
    if (lines.length >= maxLines) {
      lines.push(`… (truncated, ${ops.length - k} more op${ops.length - k === 1 ? '' : 's'})`);
      break;
    }
  }

  return { text: lines.join('\n'), adds, dels, unchanged: false, skipped: null };
}

module.exports = { unified };