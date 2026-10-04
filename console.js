'use strict';
// Ariotica console relay (Vercel serverless function).
// Keeps the GitHub token on the server so the browser never sees it.
//
// Env vars (Vercel -> Project -> Settings -> Environment Variables):
//   GH_PAT       fine-grained PAT on suryasticsai/Ariotica: Actions (R/W) + Contents (Read)
//   CONSOLE_KEY  a long random secret; the console sends it as x-console-key
// Optional: GH_OWNER, GH_REPO, GH_WORKFLOW, GH_BRANCH, ALLOWED_ORIGINS (comma list), GH_API

const crypto = require('node:crypto');

function cfg() {
  return {
    PAT: process.env.GH_PAT || '',
    KEY: process.env.CONSOLE_KEY || '',
    OWNER: process.env.GH_OWNER || 'suryasticsai',
    REPO: process.env.GH_REPO || 'Ariotica',
    WORKFLOW: process.env.GH_WORKFLOW || 'ai-cron.yml',
    BRANCH: process.env.GH_BRANCH || 'main',
    API: process.env.GH_API || 'https://api.github.com',
    ALLOWED: (process.env.ALLOWED_ORIGINS || 'https://suryasticsai.github.io')
      .split(',').map((s) => s.trim()).filter(Boolean)
  };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20000) throw new Error('Body too large');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  const c = cfg();

  // CORS: only needed when the console is served from another origin (e.g. GitHub Pages).
  const origin = req.headers.origin;
  if (origin && c.ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-console-key');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  if (!c.PAT || !c.KEY) return send(res, 500, { error: 'Relay is not configured (GH_PAT / CONSOLE_KEY missing).' });
  if (!safeEqual(req.headers['x-console-key'] || '', c.KEY)) return send(res, 401, { error: 'Bad key.' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: String(e.message) }); }

  async function gh(path, opts) {
    opts = opts || {};
    const r = await fetch(c.API + path, {
      method: opts.method || 'GET',
      headers: Object.assign({
        'Authorization': 'Bearer ' + c.PAT,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ariotica-console-relay'
      }, opts.headers || {}),
      body: opts.body
    });
    const text = await r.text();
    return { status: r.status, ok: r.ok, text };
  }
  const base = '/repos/' + c.OWNER + '/' + c.REPO;

  try {
    switch (body.action) {
      case 'dispatch': {
        const mode = String(body.mode || '');
        if (!['plan', 'apply', 'reset'].includes(mode)) return send(res, 400, { error: 'Bad mode.' });
        const prompt = String(body.prompt || '').slice(0, 4000);
        const planRev = String(body.plan_rev || '');
        if (planRev && !/^\d{1,9}$/.test(planRev)) return send(res, 400, { error: 'Bad plan_rev.' });
        if (mode === 'plan' && !prompt.trim()) return send(res, 400, { error: 'Empty prompt.' });
        if (mode === 'apply' && !planRev) return send(res, 400, { error: 'apply needs plan_rev.' });
        const r = await gh(base + '/actions/workflows/' + c.WORKFLOW + '/dispatches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: c.BRANCH, inputs: { mode, prompt, plan_rev: planRev } })
        });
        if (r.status === 204) return send(res, 200, { ok: true });
        let msg = r.text; try { msg = JSON.parse(r.text).message || r.text; } catch { /* keep raw */ }
        return send(res, 502, { error: 'GitHub ' + r.status + ': ' + String(msg).slice(0, 200) });
      }

      case 'runs': {
        const r = await gh(base + '/actions/workflows/' + c.WORKFLOW + '/runs?event=workflow_dispatch&per_page=1&branch=' + encodeURIComponent(c.BRANCH));
        if (!r.ok) return send(res, 502, { error: 'GitHub ' + r.status });
        const run = (JSON.parse(r.text).workflow_runs || [])[0] || null;
        return send(res, 200, {
          run: run && { id: run.id, status: run.status, conclusion: run.conclusion, html_url: run.html_url, created_at: run.created_at }
        });
      }

      case 'state': {
        const r = await gh(base + '/contents/state.json?ref=' + encodeURIComponent(c.BRANCH), {
          headers: { 'Accept': 'application/vnd.github.raw+json' }
        });
        if (r.status === 404) return send(res, 200, { state: null });
        if (!r.ok) return send(res, 502, { error: 'GitHub ' + r.status });
        return send(res, 200, { state: JSON.parse(r.text) });
      }

      default:
        return send(res, 400, { error: 'Unknown action.' });
    }
  } catch (e) {
    return send(res, 502, { error: 'Relay error: ' + String(e.message).slice(0, 200) });
  }
};
