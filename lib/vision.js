'use strict';

async function critiqueDesign(base64Image) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');

  const prompt = `You are an elite UI/UX designer. Look at this screenshot of a web app and critique it harshly.
Focus on:
1. Contrast and readability.
2. Spacing and alignment.
3. Visual hierarchy (is the most important thing obvious?).
4. Aesthetic quality (does it look like a 2026 SaaS, or a 1995 HTML page?).

Output your critique as a short, bulleted list of specific CSS/HTML fixes. Be extremely critical. No pleasantries.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.5,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq vision HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = { critiqueDesign };