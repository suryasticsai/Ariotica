'use strict';
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const Rag = require('./rag');
const K = require('./knowledge');
const { askAI } = require('./providers');

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const RUN_ID = process.env.RUN_ID || String(Date.now());
const FOCUS = process.env.EVOLVE_FOCUS || 'auto';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Robust JSON extractor for AI responses
function extractJson(text) {
  let clean = String(text || '').trim();
  
  // 1. Strip markdown code fences
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  
  // 2. Extract from first brace to last brace
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
  console.log('🔍 [Darwin] Retrieving relevant code chunks...');
  const chunks = K.collectRepoChunks(process.cwd(), {});
  
  // Build the RAG index
  const index = Rag.createIndex(chunks);
  
  // If a focus was provided, search for relevant chunks. Otherwise, get a general sample.
  let contextText = '';
  if (FOCUS !== 'auto') {
    const hits = index.search(FOCUS, 8);
    contextText = hits.map(h => `--- ${h.chunk.path} ---\n${h.chunk.text}`).join('\n\n');
  } else {
    // Get a sample of the lib/ folder to give the AI context on how to write plugins
    const libChunks = chunks.filter(c => c.path.startsWith('lib/')).slice(0, 10);
    contextText = libChunks.map(c => `--- ${c.path} ---\n${c.text}`).join('\n\n');
  }

  // 2. Construct the prompt
  const prompt = `You are Ariotica, a self-evolving AI system.
Your task is to write a new Node.js plugin that will improve the Ariotica codebase.
${FOCUS !== 'auto' ? `FOCUS AREA: ${FOCUS}\n` : ''}
Here is the current codebase architecture for reference:
${contextText}

CRITICAL CONTEXT:
- Plugins run inside generate.js AFTER the AI generates a web app.
- The 'context.files' object contains the USER'S GENERATED WEB APP (index.html, style.css, script.js).
- It does NOT contain the Ariotica source code.
- Therefore, plugins should be designed to mutate, optimize, or add features to the generated web app (e.g., minify CSS, inject a watermark, add SEO tags).
- DO NOT require external NPM packages unless you know they are installed in package.json (only use standard Node.js built-ins like 'crypto', 'zlib', 'fs').

Write a self-contained Node.js module that exports exactly this structure:
module.exports = {
  name: 'a-short-name',
  execute: async (context) => {
    // context.files['index.html'] is a string.
    // context.files['style.css'] is a string.
    // Modify the strings in place to apply your changes.
    // Example: context.files['index.html'] = context.files['index.html'].replace('</head>', '<meta ...>\\n</head>');
  }
};

Output a JSON object with the following schema:
{
  "title": "A short descriptive title",
  "explanation": "Why this mutation is needed (plain text, no markdown)",
  "filename": "the_name_of_the_file.js",
  "code": "the raw JavaScript code (escape newlines as \\n)",
  "commitMessage": "a short git commit message"
}

CRITICAL JSON RULES:
1. Reply with ONLY a valid JSON object. No markdown fences, no conversational text.
2. Do NOT use any markdown inside your JSON string values (no **bold**, no \`code\`, no bullet points).
3. Escape all newlines as \\n and all double quotes as \\".
4. Your entire response MUST be a single, parseable JSON object.
`;

  // 3. Ask the AI
  console.log('🧠 [Darwin] Asking AI to synthesize a mutation...');
  const response = await askAI([{ role: 'user', content: prompt }]);

  // 4. Parse the response
  const rawJson = extractJson(response.text);
  let mutation;
  try {
    mutation = JSON.parse(rawJson);
  } catch (e) {
    console.error('❌ Failed to parse AI response as JSON.');
    console.error('Raw text snippet:', rawJson.slice(0, 1000));
    process.exit(1);
  }

  // 5. Validate the parsed structure
  if (!mutation.title || !mutation.code || !mutation.filename) {
    console.error('❌ AI response is missing required fields (title, code, filename).');
    process.exit(1);
  }

  // 6. Save the proposal
  console.log(`✅ [Darwin] Mutation synthesized: "${mutation.title}"`);
  
  const proposalsDir = path.join(process.cwd(), 'proposals');
  if (!fs.existsSync(proposalsDir)) fs.mkdirSync(proposalsDir, { recursive: true });

  // Create a markdown proposal file
  const safeTitle = mutation.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const proposalPath = path.join(proposalsDir, `proposal-${safeTitle}.md`);
  
  const proposalContent = `# ${mutation.title}

${mutation.explanation}

## Proposed Code
\`\`\`javascript
${mutation.code}
\`\`\`

## Target Filename
\`${mutation.filename}\`

## Commit Message
${mutation.commitMessage || 'feat: apply AI mutation'}
`;

  fs.writeFileSync(proposalPath, proposalContent);
  console.log(`📝 [Darwin] Proposal saved to ${proposalPath}`);
}

main().catch(err => {
  console.error('❌ [Darwin] Fatal error:', err.message);
  process.exit(1);
});