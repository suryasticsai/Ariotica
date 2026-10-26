'use strict';
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const { askAI } = require('./providers'); // <--- Updated path

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function main() {
  console.log('🧬 [Darwin] Initiating self-analysis...');

  // 1. Gather context from the core engine (reads from repo root)
  let codebaseContext = '';
  const filesToRead = ['generate.js', 'lib/report.js', 'lib/providers.js', 'lib/scan.js', 'lib/libraries.js'];
  
  for (const file of filesToRead) {
    try { codebaseContext += `\n--- ${file} ---\n${fs.readFileSync(path.join(__dirname, '..', file), 'utf8').slice(0, 15000)}\n`; } catch (e) {}
  }

  // 2. Prompt the AI to find an improvement and write the code
  const prompt = `You are Ariotica, an autonomous AI software engineer.
Review your own source code below. Identify ONE bottleneck, missing feature, or optimization that would make you significantly better.
Then, write the Node.js code to implement it as a standalone script or plugin.

Output exactly in this JSON format:
{
  "title": "Short title of the improvement",
  "explanation": "Markdown explaining WHY this is needed, WHAT it does, and HOW a human should test/merge it.",
  "filename": "kebab-case-filename.js",
  "code": "The raw JavaScript code. No markdown fences."
}

CODEBASE CONTEXT:
${codebaseContext}`;

  console.log('🧠 [Darwin] Asking AI to synthesize a mutation...');
  const response = await askAI([{ role: 'user', content: prompt }], { maxTokens: 4000 });
  
  let text = response.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  let proposal;
  try {
    proposal = JSON.parse(text);
  } catch (e) {
    console.error('❌ Failed to parse AI response as JSON:', text.slice(0, 200));
    process.exit(1);
  }

  // 3. Save the proposal to the /proposals folder at the repo root
  const proposalsDir = path.join(__dirname, '..', 'proposals'); // <--- Updated path
  if (!fs.existsSync(proposalsDir)) fs.mkdirSync(proposalsDir);

  const date = new Date().toISOString().split('T')[0];
  const baseName = `${date}-${proposal.filename.replace('.js', '')}`;
  const jsPath = path.join(proposalsDir, `${baseName}.js`);
  const mdPath = path.join(proposalsDir, `${baseName}.md`);

  fs.writeFileSync(jsPath, proposal.code);
  fs.writeFileSync(mdPath, `# Proposal: ${proposal.title}\n\n${proposal.explanation}\n\n## Proposed Code\nFile: \`proposals/${baseName}.js\`\n\n\`\`\`javascript\n${proposal.code}\n\`\`\``);

  console.log(`✅ [Darwin] Proposal saved to proposals/${baseName}.(js|md)`);

  // 4. Open a GitHub Issue for the human to review
  console.log('📝 [Darwin] Opening GitHub Issue for review...');
  try {
    await octokit.issues.create({
      owner: OWNER,
      repo: REPO,
      title: `[PROPOSAL] ${proposal.title}`,
      body: proposal.explanation + `\n\n---\n\n### 💡 How to merge this\n1. Review the code in \`proposals/${baseName}.js\`.\n2. If you like it, move the code to \`lib/plugins/\` (if it's a plugin) or paste it into your core files.\n3. Close this issue.`,
      labels: ['evolution', 'proposal']
    });
    console.log('🎉 [Darwin] Issue created successfully.');
  } catch (e) {
    console.error('Failed to create issue:', e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });