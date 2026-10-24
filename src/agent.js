// One check of one watch: read the page (or search), ask Gemma "has it happened, or changed?",
// and let Gemma pick when to look next. Checking rarely is the point.
import { askJson, MODEL } from './model.js';
import { readPage } from './page.js';
import { search, searchOn } from './search.js';
import { CAPS } from './limits.js';

export const SYSTEM_PROMPT = `You are a patient, lazy assistant. A person told you what they are waiting for, so they can stop checking it themselves.
Each time you are woken up you get: what they are waiting for, today's date, what you told them last time, and the current page text (or search results).

Reply with JSON only, no markdown:
{"status": "happened" | "changed" | "delayed" | "nothing",
 "summary": one or two short sentences to send the person, in LANGUAGE,
 "details": [0 to 4 short new facts, in LANGUAGE],
 "evidence": for "happened", "changed" or "delayed": a few words copied exactly from the page or results that show it, in the page's own language; otherwise null,
 "earliest": "YYYY-MM-DD", the FIRST day it could happen (for "the week of Oct 19" that is Oct 19), or null,
 "expected": "YYYY-MM-DD", the LAST day it is likely to happen by (for "the week of Oct 19" that is the Sunday of that week), or null,
 "next_check_hours": a number,
 "done": true or false,
 "files": [{"href": a link copied exactly from the LINKS list, "name": short file name}]}

What the statuses mean:
- "happened": the thing they are waiting for has now happened, and the page or results clearly say so.
- "changed": it has not happened, but there is NEW information they would want: a new date, a delay, an extension, a new requirement, a price change. Only if it is different from what you told them last time.
- "delayed": the page says it is postponed or late.
- "nothing": no new information. Most checks should be "nothing". Then "summary" is a short note for the log only.

Choosing next_check_hours (be lazy, but don't miss it):
- If you know roughly when it will happen and that is more than 3 days away, check rarely (24 to 168 hours), timed to wake up shortly before it.
- If today is inside the expected window, within 3 days of it, or past it, check often (2 to 6 hours).
- If you have no idea when, check every 12 to 24 hours.

Rules:
- Only say "happened" when the text actually shows it. Rumours, old news and unrelated pages are "nothing".
- If what you told them last time already covers it, it is "nothing".
- Set "done": true once it has happened and there is nothing left to wait for.
- Some things happen again and again (a price changes, new posts, new results each term). If they are waiting for something like that, "done" is always false: tell them about this change and keep watching for the next one.
- "files" only if they asked you to save or download something and a matching file link is in LINKS. Never invent links.
- Plain words, for someone who is not technical.`;

// Once, when a watch without a link is added: turn the person's sentence into a short Google query.
export async function searchQueryFor(ask) {
  const { json } = await askJson(
    'Turn what the person is waiting for into a short Google search query (3 to 6 words, no quotes, no dates unless they matter) that would find news of it. Reply with JSON only: {"query": "..."}',
    ask,
  );
  return String(json.query || ask).slice(0, 100);
}

// `page` lets the eval hand in a saved copy of the page instead of fetching it live.
export async function checkWatch(watch, now = new Date(), page = null) {
  let source;
  if (watch.url) {
    page ||= await readPage(watch.url);
    if (watch.lastHash && page.hash === watch.lastHash) {
      // Same page as last time: nothing could have changed, so don't wake Gemma.
      return { at: now.toISOString(), status: 'nothing', summary: 'Page unchanged since last check.', skipped: true, nextCheckAt: later(watch, now, watch.lastInterval || 12), hash: page.hash };
    }
    source = { hash: page.hash, links: page.links, text: `${page.title || ''}\n${page.text}`, prompt: `PAGE: ${watch.url}\nTITLE: ${page.title || ''}\n\n${page.text}\n\nLINKS:\n${page.links.map((l) => `${l.href} | ${l.text}`).join('\n')}` };
  } else if (searchOn()) {
    const found = await search(watch.query || watch.ask);
    source = { links: found.results.map((r) => ({ href: r.link })), text: found.text, prompt: `SEARCH RESULTS for "${watch.query || watch.ask}" (past week):\n\n${found.text}\n\nLINKS:\n${found.results.map((r) => r.link).join('\n')}` };
  } else {
    throw new Error('This watch has no link and search is off');
  }

  const last = watch.checks?.findLast?.((c) => c.status !== 'nothing' || c.first) || watch.checks?.at(-1);
  const user = `TODAY: ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })})
WAITING FOR: ${watch.ask}
WHAT YOU TOLD THEM LAST TIME: ${last ? `${last.summary} ${(last.details || []).join(' ')}` : '(nothing yet, this is the first check)'}
EXPECTED DATE YOU NOTED: ${watch.expected || 'unknown'}

${source.prompt}`;

  const language = watch.lang === 'ur' ? 'Urdu (Urdu script)' : 'simple English';
  const { json, inTokens, outTokens, model } = await askJson(SYSTEM_PROMPT.replace(/LANGUAGE/g, language), user);
  const known = new Set(source.links.map((l) => l.href));
  const expected = /^\d{4}-\d{2}-\d{2}$/.test(json.expected || '') ? json.expected : null;
  let hours = Number(json.next_check_hours) || 12;
  // Gemma tends to stay sleepy even when the date is close, so close to (or past) the expected day we insist.
  const earliest = /^\d{4}-\d{2}-\d{2}$/.test(json.earliest || '') ? json.earliest : expected;
  const daysToStart = earliest ? (new Date(`${earliest}T00:00:00Z`) - now) / 86400e3 : Infinity;
  if (daysToStart < 3) hours = Math.min(hours, 6);
  else hours = Math.min(hours, (daysToStart - 1) * 24);
  // The model suggests, the code checks: news only goes out if Gemma can point at the words that show it.
  let status = ['happened', 'changed', 'delayed', 'nothing'].includes(json.status) ? json.status : 'nothing';
  // Sometimes it gives a list of quotes instead of one; one real quote is enough.
  const quotes = (Array.isArray(json.evidence) ? json.evidence : [json.evidence]).filter(Boolean).map((q) => String(q).slice(0, 300));
  const evidence = quotes.find((q) => quoted(q, source.text)) || quotes.join(' | ');
  const unproven = status !== 'nothing' && !quotes.some((q) => quoted(q, source.text));
  if (unproven) status = 'nothing';
  return {
    at: now.toISOString(),
    status,
    ...(unproven && { unproven: json.status, evidence }),
    summary: String(json.summary || '').slice(0, 400),
    details: (Array.isArray(json.details) ? json.details : []).slice(0, 4).map((d) => String(d).slice(0, 200)),
    expected,
    done: Boolean(json.done),
    files: (Array.isArray(json.files) ? json.files : []).filter((f) => known.has(f?.href)).slice(0, 5),
    interval: hours,
    nextCheckAt: later(watch, now, hours),
    hash: source.hash,
    model: model || MODEL,
    tokens: { in: inTokens || 0, out: outTokens || 0 },
    first: !watch.checks?.length,
  };
}

// True if the quote really is in the text (ignoring case, spacing and punctuation), and long enough to mean something.
// A quote that skips words ("India were champions... beat New Zealand") counts if every piece is there.
export function quoted(quote, text) {
  const norm = (s) => String(s).toLowerCase().normalize('NFKC').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const t = norm(text);
  const pieces = String(quote).split(/\.{3}|…/).map(norm).filter(Boolean);
  // Long enough to mean something: two words, or a number like a version ("158.0").
  const enough = (q) => q.includes(' ') && (q.length >= 6 || (q.length >= 4 && /\d/.test(q)));
  if (!pieces.length || !pieces.every(enough)) return false;
  // Second try without any spaces, for quotes like "Rs381.14" when the page says "Rs 381.14".
  return pieces.every((q) => ` ${t} `.includes(` ${q} `) || (q.length >= 12 && t.replace(/ /g, '').includes(q.replace(/ /g, ''))));
}

// Clamp Gemma's choice to the caps.
function later(watch, now, hours) {
  const min = CAPS.minMinutesBetweenChecks / 60;
  const max = CAPS.maxDaysBetweenChecks * 24;
  const h = Math.min(max, Math.max(min, hours));
  return new Date(now.getTime() + h * 3600e3).toISOString();
}
