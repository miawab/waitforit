// How often is Gemma right about "has it happened yet?", next to a plain keyword rule?
// Each case is a real page and a label checked by hand. Pages are saved once to data/eval/ so reruns see the same text.
//   node eval/run.mjs            (add --lang ur to get the summaries in Urdu)
import '../src/env.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readPage } from '../src/page.js';
import { checkWatch } from '../src/agent.js';
import { close } from '../src/store.js';

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const lang = arg('--lang') || 'en';
const out = `eval/results${lang === 'en' ? '' : '-' + lang}.json`;
// --only "Firefox|T20" reruns just the matching cases and keeps the earlier rows for the rest.
const only = arg('--only') && new RegExp(arg('--only'), 'i');
const earlier = only ? JSON.parse(await readFile(out, 'utf8')).rows : [];
const cases = JSON.parse(await readFile('eval/cases.json', 'utf8'));
await mkdir('data/eval', { recursive: true });

// What a typical "page changed" alert does: fire when a done-sounding word shows up.
const KEYWORDS = /\b(released|announced|is out|out now|now available|available now|winners?|won|launched|results)\b/i;

async function snapshot(url) {
  const file = `data/eval/${url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.json`;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    const page = { url, fetchedAt: new Date().toISOString(), ...(await readPage(url)) };
    await writeFile(file, JSON.stringify(page));
    return page;
  }
}

const rows = [];
for (const c of cases) {
  const before = earlier.find((r) => r.ask === c.ask);
  if (only && !only.test(c.ask) && before) {
    rows.push({ ...before, label: c.label });
    continue;
  }
  const page = await snapshot(c.url);
  const now = new Date(page.fetchedAt);
  const t = Date.now();
  let check;
  try {
    check = await checkWatch({ ask: c.ask, url: c.url, lang, checks: [] }, now, page);
  } catch (e) {
    check = { status: 'error', summary: e.message };
  }
  const row = {
    ask: c.ask,
    label: c.label,
    gemma: check.status === 'happened' ? 'happened' : 'not_yet',
    raw: check.unproven || check.status,
    keyword: KEYWORDS.test(page.text) ? 'happened' : 'not_yet',
    summary: check.summary,
    evidence: check.evidence,
    nextCheckHours: check.interval,
    tokens: check.tokens,
    seconds: (Date.now() - t) / 1000,
  };
  rows.push(row);
  console.log(`${row.label === row.gemma ? 'ok  ' : 'MISS'} ${c.ask} | label ${c.label} | gemma ${row.raw}${check.unproven ? ' (no proof, held back)' : ''} | keyword ${row.keyword} | next ${row.nextCheckHours}h | ${row.seconds}s`);
}

const score = (key) => {
  const s = { correct: 0, falseAlarm: 0, missed: 0 };
  for (const r of rows) {
    if (r[key] === r.label) s.correct++;
    else if (r[key] === 'happened') s.falseAlarm++;
    else s.missed++;
  }
  return s;
};
const result = { at: new Date().toISOString(), lang, cases: rows.length, gemma: score('gemma'), keyword: score('keyword'), rows };
await writeFile(out, JSON.stringify(result, null, 2));
console.log('\n| | correct | false alarms | missed |\n|---|---|---|---|');
for (const k of ['gemma', 'keyword']) console.log(`| ${k} | ${result[k].correct}/${rows.length} | ${result[k].falseAlarm} | ${result[k].missed} |`);
await close();
