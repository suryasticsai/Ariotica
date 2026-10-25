'use strict';
// Per-million-token pricing (USD). Used to estimate cost when the provider
// doesn't report it directly. Rates are published paid-tier prices — free
// tiers are free, but this shows what a paid account would have spent.
// Add more models as needed. Unknown → $0.

const PRICING = {
  // Groq
  'openai/gpt-oss-120b': { in: 0.15, out: 0.75 },
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
  'llama-3.1-70b-versatile': { in: 0.59, out: 0.79 },
  'mixtral-8x7b-32768': { in: 0.24, out: 0.24 },

  // OpenRouter
  'qwen/qwen-2.5-coder-32b-instruct': { in: 0.07, out: 0.16 },
  'qwen/qwen-2.5-72b-instruct': { in: 0.35, out: 0.40 },
  'deepseek/deepseek-chat': { in: 0.14, out: 0.28 },
  'meta-llama/llama-3.3-70b-instruct': { in: 0.12, out: 0.30 },

  // HuggingFace
  'Qwen/Qwen2.5-Coder-32B-Instruct': { in: 0.07, out: 0.16 },
};

function extractTokens(usage) {
  if (!usage) return { tin: 0, tout: 0 };
  const tin =
    usage.prompt_tokens ||
    usage.input_tokens ||
    usage.promptTokens ||
    0;
  const tout =
    usage.completion_tokens ||
    usage.output_tokens ||
    usage.completionTokens ||
    0;
  return { tin: Number(tin) || 0, tout: Number(tout) || 0 };
}

function computeCost(model, usage) {
  const { tin, tout } = extractTokens(usage);
  if (/:free$/i.test(model || '')) return { cost: 0, tin, tout };
  if (usage && typeof usage.total_cost === 'number') {
    return { cost: Number(usage.total_cost) || 0, tin, tout };
  }
  const p = PRICING[model];
  if (!p) return { cost: 0, tin, tout };
  const cost = (tin * p.in + tout * p.out) / 1_000_000;
  return { cost, tin, tout };
}

module.exports = { computeCost, extractTokens, PRICING };