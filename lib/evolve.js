'use strict';
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const { askAI } = require('./providers');
const K = require('./knowledge');
const Rag = require('./rag');

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function main() {
  console.log('🧬 [Darwin] Initiating self-analysis with RAG context...');

  const focus = process.env.EVOLVE_FOCUS || 'auto';
  let directive = "Identify ONE bottleneck, missing feature, or optimization that would make you significantly better.";
  
  if (focus !== 'auto' && focus.trim() !== '') {
    console.log(`🎯 [Darwin] Human override detected. Focusing on: "${focus}"`);
    directive = `Focus specifically on this directive: ${focus}`;
  }

  // 1. Gather context using RAG (Top 10 chunks from the repo)
  console.log('🔍 [Darwin] Retrieving relevant code chunks...');
  const chunks = K.collectRepoChunks(process.cwd(), {});
  const query = focus !== 'auto' ? focus : 'bottleneck optimization performance error handling timeout security';
  const hits = Rag.createIndex(chunks).search(query, 10);
  
  let contextStr = '';
  for (const h of hits) {
    contextStr += `\n--- ${h.chunk.path} (score ${h.score.toFixed(2)}) ---\n${h.chunk.text}\n`;
  }

  const prompt = `You are Ariotica, an autonomous AI software engineer.
Review these specific code chunks from your own source code:
${contextStr}

${directive}

Write the Node.js code to implement it as a standalone script or plugin.

Output exactly in this JSON format:
{
  "title": "Short title of the improvement",
  "explanation": "Markdown explaining WHY this is needed, WHAT it does, and HOW a human should test/merge it.",
  "filename": "kebab-case-filename.js",
  "code": "The raw JavaScript code. No markdown fences."
}`;

  console.log('🧠 [Darwin] Asking AI to synthesize a mutation...');
  const response = await askAI([{ role: 'user', content: prompt }], { maxTokens: 4000 });
  
  let text = response.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  let proposal;
  
  try {
    proposal = JSON.parse(text);
  } catch (e) {
    console.error('❌ Failed to parse AI response as JSON. Raw text snippet:', text.slice(0, 300));
    process.exit(1);
  }

  if (!proposal.title || !proposal.code || !proposal.filename) {
    console.error('❌ AI returned JSON but it is missing required fields.');
    process.exit(1);
  }

  // 2. Save to proposals/
  const proposalsDir = path.join(__dirname, '..', 'proposals');
  if (!fs.existsSync(proposalsDir)) fs.mkdirSync(proposalsDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const baseName = `${date}-${proposal.filename.replace('.js', '')}`;
  const jsPath = path.join(proposalsDir, `${baseName}.js`);
  const mdPath = path.join(proposalsDir, `${baseName}.md`);

  fs.writeFileSync(jsPath, proposal.code);
  fs.writeFileSync(mdPath, `# Proposal: ${proposal.title}\n\n${proposal.explanation}\n\n## Proposed Code\nFile: \`proposals/${baseName}.js\`\n\n\`\`\`javascript\n${proposal.code}\n\`\`\``);

  console.log(`✅ [Darwin] Proposal saved to proposals/${baseName}.(js|md)`);

  // 3. Create Issue
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