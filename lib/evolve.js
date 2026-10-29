'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Octokit } = require('@octokit/rest');
const Rag = require('./rag');
const K = require('./knowledge');
const { askAI } = require('./providers');
const PluginManager = require('./plugin-manager');

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const RUN_ID = process.env.RUN_ID || String(Date.now());
const FOCUS = process.env.EVOLVE_FOCUS || 'auto';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

function extractJson(text) {
  let clean = String(text || '').trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  return clean;
}

async function main() {
  console.log('🧬 [Darwin] Initiating self-analysis with RAG context...');

  // 1. Collect codebase context
  const chunks = K.collectRepoChunks(process.cwd(), {});
  const index = Rag.createIndex(chunks);
  
  let contextText = '';
  if (FOCUS !== 'auto') {
    const hits = index.search(FOCUS, 8);
    contextText = hits.map(h => `--- ${h.chunk.path} ---\n${h.chunk.text}`).join('\n\n');
  } else {
    const libChunks = chunks.filter(c => c.path.startsWith('lib/')).slice(0, 10);
    contextText = libChunks.map(c => `--- ${c.path} ---\n${c.text}`).join('\n\n');
  }

  // 2. Load Approved Libraries
  let catalogText = '';
  const catalogPath = path.join(process.cwd(), 'libraries_catalog.json');
  if (fs.existsSync(catalogPath)) {
    try {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      catalogText = Object.entries(catalog).map(([key, entry]) => {
        if (key === '_meta') return '';
        return `- ${entry.name}: ${entry.purpose} (CDN: ${entry.cdn.join(', ')})`;
      }).filter(Boolean).join('\n');
    } catch (e) { }
  }

  const pluginsDir = path.join(process.cwd(), 'lib', 'plugins');
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
  const existingPlugins = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
  const existingList = existingPlugins.length ? existingPlugins.join(', ') : '(none)';

  const basePrompt = `You are Ariotica, a self-evolving AI system.
Your task is to write a new Node.js plugin that improves the generated web apps.
${FOCUS !== 'auto' ? `FOCUS AREA: ${FOCUS}\n` : ''}

EXISTING PLUGINS (Do NOT duplicate these): ${existingList}

APPROVED CDN LIBRARIES:
${catalogText}

CRITICAL CONTEXT:
- The 'context.files' object contains the USER'S GENERATED WEB APP (index.html, style.css, script.js).
- Plugins must mutate these strings. They must not require external NPM packages.
- NEVER attempt to write regex-based minifiers for CSS or JS. They will break syntax.

Write a self-contained Node.js module that exports exactly this structure:
module.exports = {
  name: 'a-short-name',
  execute: async (context) => { ... }
};

Output a JSON object with this schema:
{
  "title": "A short descriptive title",
  "explanation": "Why this mutation is needed",
  "filename": "the_name_of_the_file.js",
  "code": "the raw JavaScript code (escape newlines as \\n)",
  "commitMessage": "a short git commit message"
}

CRITICAL JSON RULES:
1. Reply with ONLY a valid JSON object.
2. Do NOT use markdown inside your JSON string values.
3. Escape all newlines as \\n and all double quotes as \\".
`;

  const testContext = {
    files: {
      'index.html': '<!DOCTYPE html>\n<html>\n<head>\n<title>Test</title>\n</head>\n<body>\n<button>Click</button>\n</body>\n</html>',
      'style.css': 'body { color: black; }',
      'script.js': 'console.log("test");'
    }
  };

  let success = false;
  let finalMutation = null;
  let attemptPrompt = basePrompt;

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`\n🧠 [Darwin] Attempt ${attempt}/3: Generating mutation...`);
    let response = await askAI([{ role: 'user', content: attemptPrompt }]);

    let mutation;
    try {
      mutation = JSON.parse(extractJson(response.text));
    } catch (e) {
      console.error('❌ Failed to parse AI response as JSON.');
      attemptPrompt = basePrompt + `\n\nYour previous response was not valid JSON. Reply with ONLY a JSON object.`;
      continue;
    }

    if (!mutation.title || !mutation.code || !mutation.filename) {
      console.error('❌ Missing fields (title, code, filename).');
      attemptPrompt = basePrompt + `\n\nYour previous response was missing required fields. Try again.`;
      continue;
    }

    // ── AI SENIOR REVIEWER ──
    console.log(`🔍 [Darwin] Reviewing code for logical bugs and edge cases...`);
    const reviewPrompt = `You are a Senior Node.js Code Reviewer.
Review the following plugin code written by a junior developer. 
Find and fix ALL of the following:
1. Syntax errors (like double semicolons or stray dots).
2. Logical bugs.
3. Missing edge cases (e.g., missing HTML escaping for meta tags, missing image dimensions for OG tags, missing null checks).
4. Do NOT change the exported structure (module.exports = { name, execute }).

Here is the code:
\`\`\`javascript
${mutation.code}
\`\`\`

Output ONLY the final, perfected JavaScript code. Do not include markdown fences, explanations, or JSON. Just the raw JS code.`;

    const reviewResponse = await askAI([{ role: 'user', content: reviewPrompt }]);
    let reviewedCode = reviewResponse.text.trim();
    
    // Clean up any accidental markdown fences from the reviewer
    reviewedCode = reviewedCode.replace(/^```(?:javascript|js)?\s*/i, '').replace(/\s*```$/, '');

    console.log(`✅ [Darwin] Code reviewed and perfected.`);
    mutation.code = reviewedCode;

    // ── TEST THE PERFECTED CODE ──
    let filename = mutation.filename.replace(/[^a-z0-9-_.]/gi, '-');
    if (!filename.endsWith('.js')) filename += '.js';
    const tempPath = path.join(process.cwd(), 'temp-plugin.js');

    try {
      // A. Syntax check
      fs.writeFileSync(tempPath, mutation.code);
      execSync(`node --check "${tempPath}"`, { stdio: 'pipe' });

      // B. Sandbox runtime check
      console.log(`🧪 [Darwin] Testing plugin in secure sandbox...`);
      const validation = await PluginManager.validatePlugin(mutation.code, JSON.parse(JSON.stringify(testContext)));
      
      if (!validation.ok) throw new Error(validation.error);

      // C. Success!
      console.log(`🏆 [Darwin] Plugin passed all tests!`);
      success = true;
      finalMutation = { ...mutation, filename };
      try { fs.unlinkSync(tempPath); } catch {}
      break;

    } catch (e) {
      console.error(`❌ [Darwin] Plugin failed tests:`);
      console.error(e.stderr ? e.stderr.toString() : e.message);
      try { fs.unlinkSync(tempPath); } catch {}
      attemptPrompt = basePrompt + `\n\nYOUR PREVIOUS CODE FAILED WITH THIS ERROR:\n${e.message || e.stderr}\n\nFix the code and try again.`;
    }
  }

  // ── SAVE THE WINNING PLUGIN ──
  if (success && finalMutation) {
    const targetPath = path.join(pluginsDir, finalMutation.filename);
    fs.writeFileSync(targetPath, finalMutation.code);
    console.log(`📝 [Darwin] Installed plugin: lib/plugins/${finalMutation.filename}`);

    const proposalsDir = path.join(process.cwd(), 'proposals');
    if (!fs.existsSync(proposalsDir)) fs.mkdirSync(proposalsDir, { recursive: true });
    const safeTitle = finalMutation.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    fs.writeFileSync(
      path.join(proposalsDir, `proposal-${safeTitle}.md`),
      `# ${finalMutation.title}\n\n${finalMutation.explanation}\n\n## Target\n\`lib/plugins/${finalMutation.filename}\`\n\n## Code\n\`\`\`javascript\n${finalMutation.code}\n\`\`\``
    );
  } else {
    console.error('❌ [Darwin] Failed to generate a working plugin after 3 attempts.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ [Darwin] Fatal error:', err.message);
  process.exit(1);
});