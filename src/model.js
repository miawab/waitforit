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
  await spend('gemma');
  const { text, inTokens, outTokens } = OLLAMA ? await ollama(system, user) : await aiStudio(system, user);
  return { json: parse(text), inTokens, outTokens };
}

async function ollama(system, user) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0.1, num_predict: 900 },
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
      generationConfig: { temperature: 0.1, maxOutputTokens: 900 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`gemma ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return {
    text: (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join(''),
    inTokens: data.usageMetadata?.promptTokenCount,
    outTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

function parse(raw) {
  const s = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Gemma did not reply with JSON');
  return JSON.parse(s.slice(start, end + 1));
}
