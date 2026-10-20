// Hard caps so a busy day (or someone scripting the site) can't use up free plans or cost money.
// Counters are stored with the watches, so they hold across restarts and across cloud runs.
import { bump } from './store.js';

export const CAPS = {
  watchesPerPerson: 5,
  watchesTotal: 60,
  minMinutesBetweenChecks: 30,
  maxDaysBetweenChecks: 7,
  maxDaysWatching: 45,
  perDay: {
    gemma: Number(process.env.CAP_GEMMA_PER_DAY || 400),
    search: Number(process.env.CAP_SEARCH_PER_DAY || 8), // free SerpApi plan: 250 a month
    voice: Number(process.env.CAP_VOICE_PER_DAY || 15), // free ElevenLabs plan: 10k characters a month
    browser: Number(process.env.CAP_BROWSER_PER_DAY || 20),
  },
};

export class CapReached extends Error {}

// Call before using a paid-per-use service. Throws CapReached once today's cap is used up.
export async function spend(service) {
  const cap = CAPS.perDay[service];
  const n = await bump(`${service}:${new Date().toISOString().slice(0, 10)}`);
  if (n > cap) throw new CapReached(`${service} daily cap of ${cap} reached`);
}
