// One call to Gemma (open-weight), either hosted on Google AI Studio or running locally through Ollama.
// Adapted from scamcheck's api/check.js (same author), which uses the same two routes.
//   GEMINI_API_KEY -> Gemma 4 on Google AI Studio (the hosted version; your PC can be off)
//   OLLAMA_URL     -> Gemma 4 on your own machine (nothing leaves your PC)
import { spend } from './limits.js';

const OLLAMA = process.env.OLLAMA_URL;
export const MODEL = process.env.GEMMA_MODEL || (OLLAMA ? 'gemma4:e4b-it-qat' : 'gemma-4-26b-a4b-it');
export const aiOn = () => Boolean(process.env.GEMINI_API_KEY || OLLAMA);

// Returns the parsed JSON object Gemma replied with.
export async function askJson(system, user) {
  if (!aiOn()) throw new Error('No GEMINI_API_KEY or OLLAMA_URL set');
  // Now and then the reply is empty, cut short, or the hosted model times out: up to two more tries fix it.
  let waits = 0;
  for (let attempt = 1; ; attempt++) {
    await spend('gemma');
    try {
      const { text, inTokens, outTokens } = OLLAMA ? await ollama(system, user) : await aiStudio(system, user);
      return { json: parse(text), inTokens, outTokens };
    } catch (e) {
      // The free tier allows only so many tokens a minute: wait as long as Google says (a few times), then go on.
      if (e.retryAfter && waits++ < 4) {
        console.error(`gemma per-minute limit, waiting ${e.retryAfter}s`);
        await new Promise((r) => setTimeout(r, e.retryAfter * 1000));
        attempt--;
        continue;
      }
      if (attempt >= 3 || /gemma 4\d\d/.test(e.message)) throw e; // other 4xx (bad key, daily quota) won't get better
      console.error(`gemma try ${attempt} failed, retrying:`, e.message.slice(0, 120));
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function ollama(system, user) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      // Ollama's default context is 4,096 tokens; a page with its links is often 10,000+, so ask for room (12k still fits a 6 GB GPU).
      options: { temperature: 0.1, num_predict: 2048, num_ctx: 12288 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const data = await r.json();
  return { text: data.message?.content || '', inTokens: data.prompt_eval_count, outTokens: data.eval_count };
}

async function aiStudio(system, user) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const body = await r.text();
    const err = new Error(`gemma ${r.status}: ${body.slice(0, 200)}`);
    // A per-minute limit says when to come back ("retryDelay": "23s"); a daily one is PerDay and won't clear soon.
    if (r.status === 429 && !/PerDay/i.test(body)) err.retryAfter = Math.min(65, Number(body.match(/"retryDelay":\s*"(\d+)/)?.[1]) || 30) + 2;
    throw err;
  }
  const data = await r.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const answer = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
  // Gemma thinks first. Once in a while the answer lands only inside the thinking, so fall back to the last JSON in it,
  // but only if it finished; if it ran out of room mid-thought, that JSON is a draft, so retry instead.
  const finished = data.candidates?.[0]?.finishReason === 'STOP';
  const thought = parts.filter((p) => p.thought).map((p) => p.text || '').join('');
  if (!answer.trim()) console.error('gemma answer empty:', data.candidates?.[0]?.finishReason, data.usageMetadata?.thoughtsTokenCount, 'thinking tokens');
  return {
    text: answer.trim() ? answer : finished ? lastJson(thought) : '',
    inTokens: data.usageMetadata?.promptTokenCount,
    outTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

function lastJson(s) {
  const end = s.lastIndexOf('}');
  for (let i = s.lastIndexOf('{', end); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    try {
      JSON.parse(s.slice(i, end + 1));
      return s.slice(i, end + 1);
    } catch {}
  }
  return '';
}

function parse(raw) {
  const s = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(raw.trim() ? 'Gemma did not reply with JSON' : 'Gemma sent an empty reply');
  return JSON.parse(s.slice(start, end + 1));
}
