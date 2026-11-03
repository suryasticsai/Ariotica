'use strict';

/**
 * lib/skritimai.js
 * Direct wrapper for the Skritimai Cloudflare Worker (OpenAI-compatible).
 */

const DEFAULT_TIMEOUT_MS = 45000; // 45 seconds max (let Groq win if Kaggle is slow)
const HEALTH_TIMEOUT_MS = 3000;   // 3 seconds to check if awake

function getBaseUrl() {
  // Prioritize the new variable, fallback to the old one for safety
  return process.env.SKRITIMAI_URL || process.env.SKRITIMAI_BASE_URL || '';
}

function getApiKey() {
  return process.env.SKRITIMAI_API_KEY || 'sk-no-key';
}

function buildChatUrl(base) {
  const b = String(base).replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getApiKey()}`
  };
}

/**
 * Fast health check to see if the Worker returns a 200 (awake) or 503 (booting).
 */
async function healthCheck() {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'SKRITIMAI_URL not set' };

  const modelsUrl = base.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/models';
  const start = Date.now();

  try {
    const res = await fetch(modelsUrl, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    
    if (res.ok) {
      return { ok: true, reason: null, latencyMs: Date.now() - start };
    }
    if (res.status === 503) {
      return { ok: false, reason: 'Kaggle is booting (503)', latencyMs: Date.now() - start };
    }
    return { ok: false, reason: `HTTP ${res.status}`, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, reason: e.message, latencyMs: Date.now() - start };
  }
}

/**
 * Main entry point for Ariotica's provider race.
 */
async function call({ model = 'skritimai', messages, json = false, maxTokens, signal }) {
  const base = getBaseUrl();
  if (!base) throw new Error('Skritimai URL is not configured');

  const url = buildChatUrl(base);
  const body = {
    model,
    messages,
    max_tokens: maxTokens || 8000,
    stream: false // We use non-streaming for reliability in the race
  };
  
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // If the Worker returns 503, the Kaggle notebook is starting up.
    if (res.status === 503) {
      throw new Error('Skritimai is waking up (503 Service Unavailable)');
    }
    throw new Error(`Skritimai HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  
  if (data.error) {
    throw new Error(`Skritimai API Error: ${JSON.stringify(data.error)}`);
  }

  const choice = data.choices?.[0];
  let text = choice?.message?.content || '';
  
  if (typeof text === 'object') text = JSON.stringify(text);
  if (!text || text.length < 5) throw new Error('Skritimai returned an empty response');

  return {
    text,
    finish: choice?.finish_reason || 'stop',
    usage: data.usage || null
  };
}

module.exports = { call, healthCheck };