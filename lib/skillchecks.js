'use strict';
const fs = require('fs');
const path = require('path');

async function runChecks(skillNames, html, js) {
  const dir = path.join(process.cwd(), 'knowledge', 'skills');
  const code = html + '\n' + js;
  const failures = [];

  for (const raw of skillNames) {
    // Accept both "webrtc" and "knowledge/skills/webrtc.md"
    const basename = String(raw).replace(/^.*\//, '').replace(/\.md$/, '');
    const fullPath = path.join(dir, `${basename}.md`);

    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      console.log(`[skillchecks] Skipping missing skill: ${basename}`);
      continue;
    }

    // Parse frontmatter for status
    let status = 'draft';
    if (content.startsWith('---')) {
      const end = content.indexOf('\n---', 3);
      if (end !== -1) {
        const meta = content.slice(3, end);
        const m = meta.match(/^status:\s*(\w+)/m);
        if (m) status = m[1];
      }
    }

    // Parse ## Checks block
    const checksMatch = content.match(/## Checks\s+([\s\S]*?)(?:\n## |$)/);
    if (!checksMatch) continue;

    const checks = checksMatch[1]
      .split('\n')
      .map(l => l.match(/^-\s*(must-have-code|must-have-selector|must-not-have):\s*(.+)$/))
      .filter(Boolean)
      .map(x => ({
        type: x[1],
        // Strip backticks, quotes, and trailing whitespace the AI added
        arg: x[2].trim().replace(/^`+|`+$/g, '').replace(/^"|"$/g, '').trim()
      }));

    for (const c of checks) {
      let passed = false;
      if (c.type === 'must-have-code') passed = code.includes(c.arg);
      else if (c.type === 'must-not-have') passed = !code.includes(c.arg);
      else if (c.type === 'must-have-selector') passed = html.includes(c.arg);

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