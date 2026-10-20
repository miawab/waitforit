// Google results through SerpApi, for watches that have no link ("tell me when petrol prices change").
import { spend } from './limits.js';

export const searchOn = () => Boolean(process.env.SERPAPI_KEY);

export async function search(q) {
  await spend('search');
  const params = new URLSearchParams({ engine: 'google', q, num: '10', tbs: 'qdr:w', api_key: process.env.SERPAPI_KEY });
  const r = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`search ${r.status}`);
  const data = await r.json();
  const results = (data.organic_results || []).slice(0, 10).map((o) => ({
    title: o.title,
    link: o.link,
    source: o.source || new URL(o.link).hostname,
    date: o.date,
    snippet: o.snippet,
  }));
  return { results, text: results.map((o, i) => `[${i + 1}] ${o.title} (${o.source}${o.date ? ', ' + o.date : ''})\n${o.snippet || ''}\n${o.link}`).join('\n\n') };
}
