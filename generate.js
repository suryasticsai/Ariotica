// generate.js — RAGina / Pollinations code generator, commits via Octokit.
const fs = require('fs');
const { Octokit } = require('@octokit/rest');

const RAGINA_URL      = process.env.RAGINA_URL || 'https://ragina-crawler-ragina.vercel.app/api/ask';
const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';
const MANIFEST_PATH    = 'projects.json';

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const BRANCH = process.env.GITHUB_REF_NAME || 'main';

if (!OWNER || !REPO) {
  console.error('GITHUB_REPOSITORY not set');
  process.exit(1);
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/* ---------------- Vanilla JS rules ---------------- */
const VANILLA_RULES = `HARD CONSTRAINTS - the output MUST be a pure vanilla JavaScript single-page app.

- ONE single HTML file. Inline ALL CSS in <style> and ALL JS in <script>.
- Vanilla JavaScript only (ES2017+). No frameworks, no libraries, no build step.
- FORBIDDEN: React, Vue, Svelte, Angular, Alpine.js, htmx, jQuery, Bootstrap, Tailwind, Bulma, Font Awesome, Lit, Stencil, Ember, Backbone.
- FORBIDDEN: any external <script src="http..."> or <link href="http..."> (no CDNs).
- FORBIDDEN: ES module import/export, require(), bundler configs.
- FORBIDDEN: runtime network calls (fetch/XHR). Must work fully offline.
- FORBIDDEN: external image URLs. Use inline SVG, emoji, or CSS shapes.
- Fonts: system font stack only (system-ui, -apple-system, Segoe UI, sans-serif, Georgia, ui-monospace, Menlo).
- Use only browser APIs: DOM, CSS, localStorage, Canvas, etc.

Implement any framework-like behaviour with plain DOM manipulation:
document.createElement, template literals, event delegation, a small render() function, CSS animations.

Return ONLY the complete HTML file. No commentary. No markdown fences. No explanations.

USER REQUEST:
`;

const FORBIDDEN = [
  /<script[^>]+src\s*=\s*["']https?:\/\//i,
  /<link[^>]+href\s*=\s*["']https?:\/\//i,
  /\breact\b/i, /\bpreact\b/i, /\bvue\b/i, /\bsvelte\b/i, /\bsolid-js\b/i,
  /\balpine\.?js\b/i, /\bhtmx\b/i, /\bjquery\b/i, /\bzepto\b/i,
  /\bbootstrap\b/i, /\btailwind\b/i, /\bbulma\b/i, /\bmaterialize\b/i,
  /\bangular\b/i, /\bember\b/i, /\bbackbone\b/i, /\bknockout\b/i, /\bmithril\b/i,
  /\bstimulus\b/i, /\bturbo(?:links)?\b/i, /\blit-html\b/i, /\bstencil\b/i,
  /font-?awesome/i,
  /unpkg\.com/i, /cdn\.jsdelivr\.net/i, /cdnjs\.cloudflare\.com/i,
  /esm\.sh/i, /skypack\.dev/i, /esm\.run/i,
  /^\s*import\s+[\w{}\*\s,]+\s+from\s+["']/m,
  /\brequire\s*\(\s*["']/,
];

function isVanilla(html) {
  for (const re of FORBIDDEN) {
    if (re.test(html)) return { ok: false, hit: String(re) };
  }
  return { ok: true, hit: null };
}

function stripFences(text) {
  return text.trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '');
}

/* ---------------- Inputs ---------------- */
function resolveInputs() {
  const dProj = (process.env.DISPATCH_PROJECT || '').trim();

  if (dProj) {
    return {
      project: dProj,
      prompt:  (process.env.DISPATCH_PROMPT || '').trim(),
      improve: String(process.env.DISPATCH_IMPROVE || 'false') === 'true',
      issue:   null,
    };
  }

  const title = process.env.ISSUE_TITLE || '';
  const body  = process.env.ISSUE_BODY  || '';
  const num   = parseInt(process.env.ISSUE_NUMBER || '0', 10);

  const m = title.match(/^\[BUILD\]\s+([A-Za-z0-9 _-]+?)\s*(\[improve\])?\s*$/);
  if (!m) throw new Error('Issue title must be: [BUILD] project-name [improve]');

  return {
    project: m[1].trim(),
    prompt:  body.trim(),
    improve: !!m[2],
    issue:   num || null,
  };
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/* ---------------- AI providers ---------------- */
async function callRagina(prompt) {
  const res = await fetch(RAGINA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.error) throw new Error('error: ' + String(data.error).slice(0, 200));
  const text = data.text || data.response || (data.choices && data.choices[0]?.message?.content) || '';
  if (!text) throw new Error('empty response');
  return text;
}

async function callPollinations(prompt) {
  const res = await fetch(POLLINATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        { role: 'system', content: 'You output raw HTML files only. No markdown fences.' },
        { role: 'user',   content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.choices && data.choices[0]?.message?.content) || data.text || data.response || '';
  if (!text) throw new Error('empty response');
  return text;
}

async function askAI(prompt) {
  const providers = [
    ['RAGina',       callRagina],
    ['Pollinations', callPollinations],
  ];
  const errors = [];

  for (const [name, fn] of providers) {
    for (let i = 1; i <= 2; i++) {
      try {
        console.log(`[${name}] attempt ${i}/2 ...`);
        const text = await fn(prompt);
        console.log(`[${name}] OK (${text.length} chars)`);
        return { text, provider: name };
      } catch (e) {
        const msg = String(e.message || e).slice(0, 300);
        errors.push(`${name} #${i}: ${msg}`);
        console.log(`[${name}] failed: ${msg}`);
        if (i < 2) await new Promise(r => setTimeout(r, 4000));
      }
    }
  }
  throw new Error('All providers failed:\n' + errors.join('\n'));
}

/* ---------------- Octokit helpers ---------------- */
async function readFile(path) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: REPO, path, ref: BRANCH,
    });
    if (Array.isArray(data)) return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function writeFile(path, content, message) {
  let sha = null;
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: REPO, path, ref: BRANCH,
    });
    if (!Array.isArray(data)) sha = data.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO, path,
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  });
}

/* ---------------- Main ---------------- */
async function main() {
  const { project, prompt, improve, issue } = resolveInputs();

  if (!prompt) throw new Error('Prompt is empty');
  const slug = slugify(project);
  if (!slug) throw new Error('Project name needs at least one letter or digit');

  const filename = `${slug}.html`;

  // Load existing file if improving
  let prevHtml = null;
  if (improve) {
    prevHtml = await readFile(filename);
    if (prevHtml && prevHtml.length > 30000) {
      console.log('Previous file too large for context — generating fresh.');
      prevHtml = null;
    }
  }

  let ask = prompt;
  if (prevHtml) {
    ask = 'Improve the existing app shown below. Keep everything that already works and apply this change: ' + prompt;
  }

  let fullPrompt = VANILLA_RULES + '\n' + ask;
  if (prevHtml) fullPrompt += '\n\nCURRENT FILE (' + filename + '):\n' + prevHtml;

  console.log(`Generating ${slug} → ${filename} ...`);
  const { text, provider } = await askAI(fullPrompt);

  let html = stripFences(text);
  if (!/<html/i.test(html)) throw new Error(`${provider} did not return HTML`);

  // Vanilla validation with one retry
  let check = isVanilla(html);
  if (!check.ok) {
    console.log(`Validation failed (${check.hit}). Retrying...`);
    const strict = `IMPORTANT: Previous attempt violated the vanilla-JS rules (matched ${check.hit}). Regenerate the complete HTML from scratch.\n\n` + fullPrompt;
    const retry = await askAI(strict);
    html = stripFences(retry.text);
    check = isVanilla(html);
    if (!check.ok) throw new Error(`Still non-vanilla (matched ${check.hit})`);
  }

  // Commit the project file
  const commitMsg = `feat: ${slug}${improve ? ' (improve)' : ''}${issue ? ` (issue #${issue})` : ''}`;
  await writeFile(filename, html, commitMsg);
  console.log(`✅ Committed ${filename} (${html.length} bytes) via ${provider}`);

  // Update manifest
  let manifest = [];
  try {
    const raw = await readFile(MANIFEST_PATH);
    if (raw) manifest = JSON.parse(raw);
    if (!Array.isArray(manifest)) manifest = [];
  } catch { manifest = []; }

  const idx = manifest.findIndex(e => e.project === slug);
  const entry = {
    project: slug,
    file: filename,
    prompt: prompt.slice(0, 240),
    created: new Date().toISOString().slice(0, 19),
    improved: !!(idx !== -1),
    provider,
  };
  if (idx === -1) manifest.push(entry);
  else manifest[idx] = { ...manifest[idx], ...entry };

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', `chore: update manifest for ${slug}`);
  console.log('✅ Manifest updated');

  // Comment on issue
  if (issue) {
    const url = `https://${OWNER}.github.io/${REPO}/${filename}`;
    try {
      await octokit.issues.createComment({
        owner: OWNER, repo: REPO, issue_number: issue,
        body: `✅ Generated \`${filename}\`\n\nLive in ~1 min: ${url}`,
      });
      await octokit.issues.update({
        owner: OWNER, repo: REPO, issue_number: issue, state: 'closed',
      });
    } catch (e) {
      console.log('Could not comment/close issue:', e.message);
    }
  }
}

/* ---------------- Error handling ---------------- */
main().catch(async (err) => {
  console.error('ERROR:', err.message);

  const num = parseInt(process.env.ISSUE_NUMBER || '0', 10);
  if (num && OWNER && REPO) {
    try {
      await octokit.issues.createComment({
        owner: OWNER, repo: REPO, issue_number: num,
        body: `❌ Generation failed:\n\n\`\`\`\n${String(err.message).slice(0, 1500)}\n\`\`\``,
      });
    } catch { /* ignore */ }
  }
  process.exit(1);
});