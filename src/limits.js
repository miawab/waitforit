// Hard caps so a busy day (or someone scripting the site) can't use up free plans or cost money.
// Counters are stored with the watches, so they hold across restarts and across cloud runs.
import { bump, peek } from './store.js';

export const CAPS = {
  watchesPerPerson: 5,
  watchesTotal: 60,
  minMinutesBetweenChecks: 30,
  quickChecksPer2h: 8, // checks under 30 minutes apart, only around a known exact time
  maxDaysBetweenChecks: 7,
  maxDaysWatching: 45,
  // Background checks may use this share of each daily AI cap; the rest stays free for people trying the site.
  tickShare: 0.7,
  perDay: {
    gemma: Number(process.env.CAP_GEMMA_PER_DAY || 400),
    groq: Number(process.env.CAP_GROQ_PER_DAY || 300), // free Groq plan: about 1,000 requests a day per model
    search: Number(process.env.CAP_SEARCH_PER_DAY || 8), // free SerpApi plan: 250 a month
    voice: Number(process.env.CAP_VOICE_PER_DAY || 8), // ElevenLabs runs out monthly (this key: 5,000 credits); notes are max 150 characters
    browser: Number(process.env.CAP_BROWSER_PER_DAY || 20),
  },
};

// Voice notes (the one plan that runs out for the month) are only made inside these windows: "start/end,start/end" in UTC.
// Default: from each submission deadline to the end of its judging. Practice voice notes are saved once and always play.
const VOICE_WINDOWS = process.env.VOICE_WINDOWS || '2026-10-26T07:00Z/2026-11-02T00:00Z,2026-11-20T22:00Z/2026-11-26T00:00Z';
export const voiceOpen = (now = new Date()) =>
  VOICE_WINDOWS.split(',').some((w) => {
    const [a, b] = w.split('/').map((s) => new Date(s.trim()));
    return now >= a && now < b;
  });

export class CapReached extends Error {
  name = 'CapReached';
}

// True once background checks have used their share of today's AI calls or searches.
export async function tickBudgetUsed() {
  const day = new Date().toISOString().slice(0, 10);
  for (const s of ['gemma', 'groq', 'search']) if ((await peek(`${s}:${day}`)) >= CAPS.perDay[s] * CAPS.tickShare) return true;
  return false;
}

// Call before using a paid-per-use service. Throws CapReached once today's cap is used up.
export async function spend(service) {
  const cap = CAPS.perDay[service];
  const n = await bump(`${service}:${new Date().toISOString().slice(0, 10)}`);
  if (n > cap) throw new CapReached(`${service} daily cap of ${cap} reached`);
}
