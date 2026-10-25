'use strict';
const D = require('./diff');

const FILE_ORDER = ['index.html', 'style.css', 'script.js'];
const CHANGELOG_MAX = 60000;

function buildChangeReport(oldFiles, newFiles, isNew) {
  const reports = [];
  for (const name of FILE_ORDER) {
    const oldText = oldFiles[name] || '';
    const newText = newFiles[name] || '';
    if (!newText) continue;
    if (oldText === newText) continue;
    const d = D.unified(oldText, newText, { maxLines: 250 });
    reports.push({
      name,
      adds: d.adds,
      dels: d.dels,
      text: d.text,
      isNew: !oldText,
      skipped: d.skipped,
    });
  }
  return reports;
}

function formatDiffBlock(name, text, adds, dels) {
  return `<details><summary>🔍 <code>${name}</code> (+${adds} −${dels})</summary>\n\n\`\`\`diff\n${text}\n\`\`\`\n\n</details>\n\n`;
}

function formatFilesTable(diffReports, newFiles) {
  let out = `| File | + | − |\n|------|-----|-----|\n`;
  for (const r of diffReports) out += `| \`${r.name}\` | +${r.adds} | −${r.dels} |\n`;
  if (!diffReports.length) {
    out = `| File | Lines |\n|------|-------|\n`;
    for (const name of FILE_ORDER) {
      const lines = (newFiles[name] || '').split('\n').length;
      if (lines > 1) out += `| \`${name}\` | ${lines} |\n`;
    }
  }
  return out;
}

function buildSummaryComment(opts) {
  const {
    mode, baseDir, version, provider, model, raceReport,
    smoke, security, metaJson, resolved, totalCost, totalIn, totalOut,
    receipt, receiptPath, diffReports, newFiles, extraNotes,
  } = opts;

  const url = `https://${opts.owner}.github.io/${opts.repo}/${baseDir}/`;
  const folderUrl = `https://github.com/${opts.owner}/${opts.repo}/tree/${opts.branch}/${baseDir}`;

  let body = `✅ **${mode}** complete: \`${baseDir}/\` via **${provider}**${model ? ` (${model})` : ''}\n\n`;
  body += `🌐 **Live App:** ${url}\n`;
  body += `📁 **Source Code:** ${folderUrl}\n\n`;
  body += `**🏷️ Version:** \`v${version}\` · **💰 Cost:** $${totalCost.toFixed(4)} · ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out tokens\n`;

  // What changed (from AI's own summary)
  const feats = metaJson.features || [];
  const fixes = metaJson.fixes || [];
  if (feats.length || fixes.length) {
    body += `\n### ✨ What changed\n`;
    for (const f of feats) body += `- ✨ ${f}\n`;
    for (const f of fixes) body += `- 🐛 ${f}\n`;
  }

  // Files changed + inline diffs
  if (diffReports && diffReports.length) {
    body += `\n### 📊 Files changed\n\n${formatFilesTable(diffReports, newFiles)}\n`;
    for (const r of diffReports) {
      if (r.text) body += formatDiffBlock(r.name, r.text, r.adds, r.dels);
      else if (r.skipped) body += `<details><summary>🔍 <code>${r.name}</code> (+${r.adds} −${r.dels})</summary>\n\n_${r.skipped}_\n\n</details>\n\n`;
    }
  } else if (newFiles) {
    body += `\n### 📊 Files\n\n${formatFilesTable([], newFiles)}\n`;
  }

  // Race, smoke, libraries, security
  if (raceReport && raceReport.length > 1) {
    const rows = raceReport.filter(r => r.provider).slice(-6)
      .map(r => `${r.provider}${r.sec != null ? ` ${r.sec}s` : ''} ${r.reason === 'lost the race' ? '⏹️' : r.ok ? '✅' : '❌'}`);
    if (rows.length > 1) body += `\n🏁 Model race: ${rows.join(' · ')}\n`;
  }
  if (smoke && !smoke.skipped) {
    body += `🧪 Smoke test: ${smoke.ok ? 'passed' : `⚠️ ${smoke.errors.length} issue(s)`}\n`;
  }
  if (resolved && resolved.discovered && resolved.discovered.length) {
    body += `\n📚 **Libraries cached:** ${resolved.discovered.map(d => `\`${new URL(d.url).hostname}\``).join(', ')}\n`;
  }
  if (security && security.findings && security.findings.length) {
    body += `\n**⚠️ Scanner findings (${security.findings.length}):**\n${security.findings.slice(0, 5).map(f => `- [${f.sev}] ${f.msg}`).join('\n')}\n`;
  }

  // Extra notes (used by revert)
  if (extraNotes) body += `\n${extraNotes}\n`;

  // Receipt
  body += `\n🧾 Receipt: [\`sha256:${receipt.sha256.slice(0, 12)}…\`](https://github.com/${opts.owner}/${opts.repo}/blob/${opts.branch}/${receiptPath})\n`;

  // Suggestions
  const sugg = metaJson.suggestions || [];
  if (sugg.length) {
    body += `\n### 💡 Suggested next steps\n${sugg.map(s => `- ${s}`).join('\n')}\n`;
  }

  return body;
}

function buildChangelogEntry(opts) {
  const { version, mode, when, provider, model, totalCost, diffReports, metaJson, oldChangelog, isNew, extraNotes } = opts;

  const lines = [`## v${version} — ${when.replace('T', ' ').slice(0, 16)} UTC — ${mode}`, ''];
  lines.push(`**Model:** ${provider}/${model || 'unknown'} · **Cost:** $${totalCost.toFixed(4)}`);
  lines.push('');

  const feats = (metaJson && metaJson.features) || [];
  const fixes = (metaJson && metaJson.fixes) || [];
  if (feats.length || fixes.length) {
    lines.push('### What changed');
    for (const f of feats) lines.push(`- ✨ ${f}`);
    for (const f of fixes) lines.push(`- 🐛 ${f}`);
    lines.push('');
  }

  if (extraNotes) { lines.push(extraNotes); lines.push(''); }

  if (diffReports && diffReports.length) {
    lines.push('### Files');
    for (const r of diffReports) lines.push(`- \`${r.name}\` (+${r.adds} −${r.dels})`);
    lines.push('');
    for (const r of diffReports) {
      if (!r.text) continue;
      lines.push(`#### \`${r.name}\``);
      lines.push('```diff');
      lines.push(r.text);
      lines.push('```');
      lines.push('');
    }
  } else if (isNew) {
    lines.push('### Files');
    lines.push('New project — see source files for initial content.');
    lines.push('');
  }

  if (metaJson && metaJson.humanInvolvement && metaJson.humanInvolvement !== 'None') {
    lines.push('### Human follow-up');
    lines.push(metaJson.humanInvolvement);
    lines.push('');
  }
  if (metaJson && metaJson.suggestions && metaJson.suggestions.length) {
    lines.push('### Next');
    for (const s of metaJson.suggestions) lines.push(`- ${s}`);
    lines.push('');
  }

  // Prepend new entry to existing content
  const header = '# Changelog\n\n';
  let existing = String(oldChangelog || '');
  if (existing.startsWith('# Changelog')) {
    const idx = existing.indexOf('\n\n');
    existing = idx >= 0 ? existing.slice(idx + 2).trim() : '';
  }
  let result = header + lines.join('\n') + (existing ? '\n\n' + existing : '') + '\n';
  if (result.length > CHANGELOG_MAX) {
    const cut = result.lastIndexOf('\n', CHANGELOG_MAX);
    result = result.slice(0, cut) + '\n\n---\n\n_Older entries truncated._\n';
  }
  return result;
}

module.exports = { buildChangeReport, buildSummaryComment, buildChangelogEntry };