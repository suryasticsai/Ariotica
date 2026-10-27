'use strict';
const fs = require('fs');
const path = require('path');

function parseChecks(md) {
  const m = md.match(/## Checks\s+([\s\S]*?)(?:\n## |$)/);
  if (!m) return [];
  return m[1].split('\n')
    .map(l => l.match(/^-\s*(must-have-code|must-have-selector|must-not-have):\s*(.+)$/))
    .filter(Boolean)
    .map(x => ({ type: x[1], arg: x[2].trim() }));
}

async function runChecks(skillNames, html, js) {
  const dir = path.join(process.cwd(), 'knowledge', 'skills');
  const code = html + '\n' + js;
  const failures = [];

  for (const name of skillNames) {
    try {
      const raw = fs.readFileSync(path.join(dir, `${name}.md`), 'utf8');
      const checks = parseChecks(raw);
      for (const c of checks) {
        let passed = false;
        if (c.type === 'must-have-code') passed = code.includes(c.arg);
        else if (c.type === 'must-not-have') passed = !code.includes(c.arg);
        else if (c.type === 'must-have-selector') {
          // Simple regex-based selector check since we can't run a full DOM here
          const sel = c.arg.split(',')[0].replace(/[\[\]]/g, '');
          passed = html.includes(sel) || html.includes(c.arg);
        }
        if (!passed) failures.push(`[${name}] Skill requirement not met: ${c.type} "${c.arg}"`);
      }
    } catch (e) { /* Skill file not found or invalid */ }
  }
  return failures;
}

module.exports = { runChecks };