'use strict';

// Helper for delay between retries
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function critiqueDesign(base64Image) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.warn('[vision] GROQ_API_KEY not set. Skipping visual audit.');
    return '';
  }

  // 1. Sanitize Base64 (Prevent Groq 400 errors if the prefix is already there)
  let cleanBase64 = base64Image;
  if (cleanBase64.startsWith('data:image')) {
    cleanBase64 = cleanBase64.split(',')[1];
  }

  const systemPrompt = `You are an elite, highly critical UI/UX designer reviewing a screenshot of a generated web app. 
You must ruthlessly critique the design. Focus on:
1. Contrast and readability (text legibility against backgrounds).
2. Spacing and alignment (padding, margins, grid consistency).
3. Visual hierarchy (is the primary action obvious?).
4. Aesthetic quality (does it look modern, or dated?).
5. Mobile responsiveness (do elements look cramped?).

RULES:
- Output ONLY a concise, bulleted list of specific, actionable CSS/HTML fixes.
- No introductions. No pleasantries. No markdown code fences.
- Example output: "- Increase .card background contrast to #1a1a1a. - Add 16px margin-top to .display heading. - The primary button is too small, increase padding to 12px 24px."`;

  const userPrompt = 'Critique this screenshot and provide the CSS/HTML fixes.';

  const maxRetries = 3;
  let attempt = 1;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          // Groq's current best vision model
          model: 'llama-3.2-90b-vision-preview', 
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${cleanBase64}` } },
              ],
            },
          ],
          max_tokens: 800, // Enough for a detailed critique, not enough to ramble
          temperature: 0.3, // Lower temperature = more deterministic, rule-based fixes
        }),
      });

      clearTimeout(timeoutId);

      // 2. Handle Rate Limits (429) and Server Errors (5xx) with a retry
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`Groq API HTTP ${res.status} (Retryable)`);
        }
        const body = await res.text().catch(() => '');
        throw new Error(`Groq vision HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const critique = data.choices?.[0]?.message?.content || '';
      
      // 3. Clean up any accidental markdown fences the model might output
      return critique.trim().replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');

    } catch (err) {
      clearTimeout(timeoutId);
      
      const isAbort = err.name === 'AbortError';
      const isRetryable = err.message.includes('Retryable') || isAbort;

      if (attempt === maxRetries || !isRetryable) {
        console.warn(`[vision] Critique failed after ${attempt} attempts: ${isAbort ? 'Timeout' : err.message}`);
        return ''; // Graceful fallback: return empty so the build continues without visual fixes
      }

      console.log(`[vision] Attempt ${attempt} failed (${isAbort ? 'Timeout' : err.message}). Retrying in ${attempt * 2}s...`);
      await sleep(attempt * 2000); // Exponential backoff (2s, 4s)
      attempt++;
    }
  }

  return '';
}

module.exports = { critiqueDesign };