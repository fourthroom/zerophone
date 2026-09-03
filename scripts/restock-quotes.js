const fs = require('fs');
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.log('[Restock] No GEMINI_API_KEY detected. Keeping existing quotes.');
  process.exit(0);
}

async function runRestock() {
  const prompt = `Generate a valid JSON array containing exactly 25 profound, contemplative, authentic quotes from primary religious and philosophical texts.
Cover: Western Philosophy, Eastern Philosophy, Christianity, Buddhism (Zen, Tibetan, Madhyamaka), Islam (Sufism), Hinduism (Vedanta, Gita, Upanishads), and Esoteric/Hermeticism.
Format each item strictly as:
{
  "quote": "...",
  "author": "...",
  "work": "...",
  "tradition": "...",
  "school": "..."
}
Output ONLY raw JSON. No markdown backticks, no markdown fence, no preamble.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
      })
    });

    const data = await response.json();
    let rawText = data.candidates[0].content.parts[0].text.trim();
    rawText = rawText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const targetPath = path.join(__dirname, '..', 'wisdom-quotes.json');
      fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), 'utf-8');
      console.log(`[Restock] Successfully wrote ${parsed.length} fresh quotes to wisdom-quotes.json`);
    } else {
      console.warn('[Restock] Output was not an array. Retaining current file.');
    }
  } catch (err) {
    console.error('[Restock Error]', err.message);
  }
}

runRestock();