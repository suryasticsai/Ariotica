'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function critiqueDesign(base64Image) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.warn('[vision] GROQ_API_KEY not set. Skipping visual audit.');
    return '';
  }

  let cleanBase64 = base64Image;
  if (cleanBase64.startsWith('data:image')) {
    cleanBase64 = cleanBase64.split(',')[1];
  }

  const systemPrompt = `You are an elite, highly critical UI/UX designer reviewing a screenshot of a generated web app. 
You must ruthlessly critique the design. Focus on:
1. Contrast and readability.
2. Spacing and alignment.
3. Visual hierarchy.
4. Aesthetic quality.

RULES:
- Output ONLY a concise, bulleted list of specific, actionable CSS/HTML fixes.
- No introductions. No pleasantries. No markdown code fences.`;

  const userPrompt = 'Critique this screenshot and provide the CSS/HTML fixes.';
  const maxRetries = 2;
  let attempt = 1;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          // FIXED: Updated to the active Groq Vision model
          model: 'llama-3.2-11b-vision-instruct', 
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
          max_tokens: 800,
          temperature: 0.3,
        }),
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`Groq API HTTP ${res.status} (Retryable)`);
        }
        const body = await res.text().catch(() => '');
        throw new Error(`Groq vision HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const critique = data.choices?.[0]?.message?.content || '';
      return critique.trim().replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');

    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = err.name === 'AbortError';
      const isRetryable = err.message.includes('Retryable') || isAbort;

      if (attempt === maxRetries || !isRetryable) {
        console.warn(`[vision] Critique failed after ${attempt} attempts: ${isAbort ? 'Timeout' : err.message}`);
        return ''; 
      }

      console.log(`[vision] Attempt ${attempt} failed. Retrying...`);
      await sleep(attempt * 2000); 
      attempt++;
    }
  }
  return '';
}

module.exports = { critiqueDesign };