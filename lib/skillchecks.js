'use strict';
const fs = require('fs');
const path = require('path');

async function runChecks(skillPaths, html, js) {
  const dir = path.join(process.cwd(), 'knowledge', 'skills');
  const code = html + '\n' + js;
  const failures = [];

  for (const skillPath of skillPaths) {
    const basename = path.basename(skillPath, '.md');
    const fullPath = path.join(dir, `${basename}.md`);

    let raw;
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch {
      console.log(`[skillchecks] Skipping missing skill: ${basename}`);
      continue;
    }

    // Parse frontmatter for status
    let status = 'draft';
    if (raw.startsWith('---')) {
      const end = raw.indexOf('\n---', 3);
      if (end !== -1) {
        const meta = raw.slice(3, end);
        const m = meta.match(/^status:\s*(\w+)/m);
        if (m) status = m[1];
      }
    }

    // Parse ## Checks block
    const checksMatch = raw.match(/## Checks\s+([\s\S]*?)(?:\n## |$)/);
    if (!checksMatch) continue;

    const checks = checksMatch[1]
      .split('\n')
      .map(l => l.match(/^-\s*(must-have-code|must-have-selector|must-not-have):\s*(.+)$/))
      .filter(Boolean)
      .map(x => ({ type: x[1], arg: x[2].trim() }));

    for (const c of checks) {
      let passed = false;
      if (c.type === 'must-have-code') passed = code.includes(c.arg);
      else if (c.type === 'must-not-have') passed = !code.includes(c.arg);
      else if (c.type === 'must-have-selector') {
        const sel = c.arg.split(',')[0].replace(/[\[\]]/g, '');
        passed = html.includes(sel) || html.includes(c.arg);
      }
      if (!passed) {
        const msg = `[${basename}] Skill requirement not met: ${c.type} "${c.arg}"`;
        if (status === 'verified') failures.push(msg);
        else console.log(`[skillchecks] Draft ${msg} (not failing build)`);
      }
    }
  }

  return failures;
}

module.exports = { runChecks };