'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'libraries_catalog.json');
const TRUSTED_PATH = path.join(ROOT, 'trusted_domains.json');
const CACHE_PATH = path.join(ROOT, 'libraries_cache.json');

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) throw new Error('libraries_catalog.json missing');
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function loadTrusted() {
  if (!fs.existsSync(TRUSTED_PATH)) return new Set();
  const raw = JSON.parse(fs.readFileSync(TRUSTED_PATH, 'utf8'));
  return new Set((raw.domains || []).map(d => d.toLowerCase()));
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return { version: 1, entries: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (!raw.entries) raw.entries = {};
    return raw;
  } catch { return { version: 1, entries: {} }; }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function computeSRI(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('sha384').update(buf).digest('base64');
  return { sri: `sha384-${hash}`, bytes: buf.length };
}

function extractExternalRefs(html) {
  const refs = [];
  let m;
  const scriptRe = /<script\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/script>/gi;
  while ((m = scriptRe.exec(html))) refs.push({ kind: 'script', url: m[1], tag: m[0] });
  const linkRe = /<link\b[^>]*?\brel\s*=\s*["']stylesheet["'][^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  while ((m = linkRe.exec(html))) refs.push({ kind: 'style', url: m[1], tag: m[0] });
  return refs;
}

function sanitizeTag(ref, sri) {
  const extras = [];
  if (/\bdefer\b/i.test(ref.tag)) extras.push('defer');
  if (/\basync\b/i.test(ref.tag)) extras.push('async');
  if (/\btype\s*=\s*["']module["']/i.test(ref.tag)) extras.push('type="module"');
  const ex = extras.length ? ' ' + extras.join(' ') : '';
  if (ref.kind === 'script') {
    return `<script src="${ref.url}"${ex} integrity="${sri}" crossorigin="anonymous"></script>`;
  }
  return `<link rel="stylesheet" href="${ref.url}" integrity="${sri}" crossorigin="anonymous">`;
}

async function resolveHtml(html) {
  const catalog = loadCatalog();
  const trusted = loadTrusted();
  const cache = loadCache();
  const refs = extractExternalRefs(html);

  const scriptOrigins = new Set();
  const styleOrigins = new Set();
  const connectOrigins = new Set();
  const discovered = [];
  let cacheChanged = false;
  let out = html;

  // Pre-map exact catalog URLs -> connects, so we can add WebSockets for PeerJS
  const catalogConnects = {};
  for (const entry of Object.values(catalog)) {
    if (entry._meta) continue;
    for (const u of (entry.cdn || [])) catalogConnects[u] = entry.connects || [];
  }

  for (const ref of refs) {
    let host;
    try { host = new URL(ref.url).hostname.toLowerCase(); }
    catch { throw new Error(`Invalid URL: ${ref.url}`); }

    if (!trusted.has(host)) {
      throw new Error(
        `Untrusted CDN: ${host}\n` +
        `URL: ${ref.url}\n` +
        `If intentional, add "${host}" to trusted_domains.json.`
      );
    }

    if (ref.kind === 'script') scriptOrigins.add(`https://${host}`);
    else styleOrigins.add(`https://${host}`);

    // Catalog hint wins for connect-src
    const c = catalogConnects[ref.url];
    if (c) for (const w of c) connectOrigins.add(w);
    // PeerJS sanity fallback in case the URL was version-bumped outside the catalog
    if (/peerjs/i.test(ref.url)) {
      connectOrigins.add('wss://0.peerjs.com');
      connectOrigins.add('wss://signaling.peerjs.com');
    }

    let entry = cache.entries[ref.url];
    if (!entry || !entry.sri) {
      console.log(`[libraries] computing SRI for ${ref.url}`);
      const { sri, bytes } = await computeSRI(ref.url);
      entry = { sri, bytes, verifiedAt: new Date().toISOString() };
      cache.entries[ref.url] = entry;
      discovered.push({ url: ref.url, sri, bytes });
      cacheChanged = true;
    }

    out = out.replace(ref.tag, sanitizeTag(ref, entry.sri));
  }

  const csp = buildCsp([...scriptOrigins], [...styleOrigins], [...connectOrigins]);
  return { html: out, discovered, csp, cacheChanged, cache };
}

function buildCsp(scriptOrigins, styleOrigins, connectOrigins) {
  const scripts = ["'self'", "'unsafe-inline'", ...scriptOrigins].join(' ');
  const styles  = ["'self'", "'unsafe-inline'", ...styleOrigins].join(' ');
  
  // Allow images from trusted domains, data URIs, blobs, and any CDN that serves images
  const imgs    = ["'self'", 'data:', 'blob:', "https://picsum.photos", "https://api.nasa.gov", ...scriptOrigins, ...styleOrigins].join(' ');
  
  const fonts   = ["'self'", "https://fonts.gstatic.com", ...styleOrigins].join(' ');
  const media   = ["'self'", 'blob:'].join(' ');
  const conns   = ["'self'", ...connectOrigins, "https://api.nasa.gov"].join(' ');
  
  return [
    `default-src 'self' 'unsafe-inline' ${[...scriptOrigins, ...styleOrigins].join(' ')};`,
    `script-src ${scripts};`,
    `style-src ${styles};`,
    `img-src ${imgs};`,
    `font-src ${fonts};`,
    `media-src ${media};`,
    `connect-src ${conns};`,
  ].join(' ');
}

// Render the catalog as an AI-readable prompt section (goes inside RULES).
function buildPromptSection() {
  const catalog = loadCatalog();
  const lines = [
    '',
    'APPROVED LIBRARIES',
    'Vanilla JS is the default. Use a library ONLY when the prompt genuinely calls for it.',
    'When you use one of the below, include the exact CDN URL from the "URL" line — do NOT add integrity or crossorigin attributes yourself (the build system verifies and injects them).',
    '',
  ];
  for (const [key, entry] of Object.entries(catalog)) {
    if (key === '_meta') continue;
    lines.push(`### ${key} — ${entry.name}`);
    lines.push(`Purpose: ${entry.purpose}`);
    for (const u of entry.cdn) lines.push(`URL: ${u}`);
    if (entry.docs) lines.push(`Docs: ${entry.docs}`);
    lines.push(`How to use: ${entry.usage}`);
    lines.push('Example:');
    lines.push(entry.example);
    lines.push('');
  }
  lines.push('Every external <script src> / <link href> MUST come from the catalog above. No invented URLs. No hallucinated SRI hashes.');
  return lines.join('\n');
}

// Strip external scripts/styles so jsdom smoke test doesn't try to fetch them.
function stripExternalForTests(html) {
  let out = html;
  
  // Replace external scripts with mock versions so jsdom doesn't crash
  out = out.replace(/<script\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/script>/gi, (match, url) => {
    if (/peerjs/i.test(url)) {
      return `<script>window.Peer = function(){return{on:function(){},connect:function(){return{on:function(){},open:false,close:function(){},send:function(){}}},call:function(){return{on:function(){},close:function(){},answer:function(){}}},destroy:function(){}}};</script>`;
    }
    if (/vue/i.test(url)) {
      return `<script>window.Vue = {createApp:function(){return{mount:function(){},use:function(){},component:function(){}}},ref:function(v){return{value:v}},computed:function(f){return{value:f()}},onMounted:function(){},watch:function(){}};</script>`;
    }
    if (/chart/i.test(url)) {
      return `<script>window.Chart = function(){return{destroy:function(){},update:function(){}}};</script>`;
    }
    if (/marked/i.test(url)) {
      return `<script>window.marked = {parse:function(s){return s;}};</script>`;
    }
    if (/purify|dompurify/i.test(url)) {
      return `<script>window.DOMPurify = {sanitize:function(s){return s;}};</script>`;
    }
    if (/bootstrap/i.test(url)) {
      return `<script>window.bootstrap = {};</script>`;
    }
    return ''; // Strip unknown external scripts
  });
  
  // Strip external stylesheets
  out = out.replace(/<link\b[^>]*?\brel\s*=\s*["']stylesheet["'][^>]*?\bhref\s*=\s*["']https?:[^"']+["'][^>]*>/gi, '');
  
  return out;
}

module.exports = {
  loadCatalog, loadTrusted, loadCache, saveCache,
  computeSRI, extractExternalRefs, sanitizeTag,
  resolveHtml, buildCsp, buildPromptSection, stripExternalForTests,
};