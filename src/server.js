import './env.js';
// The web page and its small API. No framework: node:http is enough for a handful of routes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { addWatch, getWatch, listWatches, countActive, updateWatch, removeWatch, bump, getPerson, setPerson, getVoice } from './store.js';
import { searchQueryFor } from './agent.js';
import { runWatch, tick, useTimers } from './tick.js';
import { safeUrl } from './page.js';
import { CAPS, CapReached } from './limits.js';
import { pushOn } from './notify.js';

const PORT = Number(process.env.PORT || 3000);
const ADDS_PER_IP_PER_DAY = 10;
const TICK_SECRET = process.env.TICK_SECRET;
let ticking = false;
useTimers();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function body(req) {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 10_000) throw new Error('too big');
  }
  return s ? JSON.parse(s) : {};
}

const ownerOf = (req) => {
  const o = String(req.headers['x-owner'] || '');
  return /^[a-z0-9-]{16,40}$/.test(o) ? o : null;
};
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const today = () => new Date().toISOString().slice(0, 10);

// What the page needs to show a watch (never the raw page hash or other people's data).
const view = (w) => ({
  id: w._id,
  ask: w.ask,
  url: w.url,
  query: w.query,
  lang: w.lang,
  status: w.active ? w.status : w.status === 'happened' ? 'happened' : 'stopped',
  active: w.active,
  expected: w.expected,
  nextCheckAt: w.active ? w.nextCheckAt : null,
  createdAt: w.createdAt,
  files: w.files || [],
  checks: (w.checks || []).map(({ at, status, summary, details, skipped, voice }) => ({ at, status, summary, details, skipped, voice })),
});

async function api(req, res, path) {
  const owner = ownerOf(req);

  if (req.method === 'POST' && path === '/api/watches') {
    if (!owner) return send(res, 400, { error: 'no_owner' });
    const b = await body(req);
    const ask = String(b.ask || '').trim().slice(0, 200);
    if (ask.length < 4) return send(res, 400, { error: 'say what you are waiting for' });
    let url = null;
    if (b.url) {
      try {
        url = await safeUrl(String(b.url).trim());
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if ((await countActive(owner)) >= CAPS.watchesPerPerson) return send(res, 429, { error: `you can wait for ${CAPS.watchesPerPerson} things at once. Stop one first.` });
    if ((await countActive()) >= CAPS.watchesTotal) return send(res, 429, { error: 'the site is full right now, try tomorrow' });
    if ((await bump(`adds:${ipOf(req)}:${today()}`)) > ADDS_PER_IP_PER_DAY) return send(res, 429, { error: 'too many new watches today' });

    let w;
    try {
      const query = url ? null : await searchQueryFor(ask);
      w = await addWatch({ owner, ask, url, query, lang: b.lang === 'ur' ? 'ur' : 'en', nextCheckAt: new Date().toISOString(), status: 'waiting' });
      // First check right away, so the person sees what it understood.
      await runWatch(w);
      return send(res, 200, view(await getWatch(w._id)));
    } catch (e) {
      console.error('add', e.message);
      if (w) await removeWatch(w._id); // a watch whose first look failed would just sit there broken
      if (e instanceof CapReached) return send(res, 429, { error: 'busy today, try tomorrow' });
      if (e.outage) return send(res, 503, { error: "The AI can't be reached right now (today's free quota is used up). Nothing was saved; try again later." });
      return send(res, 502, { error: `couldn't read that: ${e.message.slice(0, 120)}` });
    }
  }

  if (req.method === 'GET' && path === '/api/watches') {
    if (!owner) return send(res, 200, []);
    return send(res, 200, (await listWatches(owner)).map(view));
  }

  const stop = path.match(/^\/api\/watches\/([a-f0-9-]{36})\/stop$/);
  if (req.method === 'POST' && stop) {
    const w = await getWatch(stop[1]);
    if (!w || w.owner !== owner) return send(res, 404, { error: 'not found' });
    await updateWatch(w._id, { active: false, status: w.status === 'happened' ? 'happened' : 'stopped' });
    return send(res, 200, { ok: true });
  }

  // Gone for good: the watch, its history and its voice note.
  const remove = path.match(/^\/api\/watches\/([a-f0-9-]{36})\/remove$/);
  if (req.method === 'POST' && remove) {
    const w = await getWatch(remove[1]);
    if (!w || w.owner !== owner) return send(res, 404, { error: 'not found' });
    await removeWatch(w._id);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && path === '/api/config') {
    return send(res, 200, { push: pushOn() ? process.env.VAPID_PUBLIC_KEY : null, caps: { watches: CAPS.watchesPerPerson } });
  }

  // The browser hands us its push subscription; we keep up to 5 per person (phone, laptop, ...).
  if (req.method === 'POST' && path === '/api/push') {
    if (!owner) return send(res, 400, { error: 'no_owner' });
    const sub = await body(req);
    if (!/^https:\/\//.test(sub?.endpoint || '') || !sub.keys?.p256dh || !sub.keys?.auth) return send(res, 400, { error: 'bad subscription' });
    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    const others = ((await getPerson(owner))?.push || []).filter((s) => s.endpoint !== clean.endpoint);
    await setPerson(owner, { push: [...others, clean].slice(-5) });
    return send(res, 200, { ok: true });
  }

  const voice = path.match(/^\/api\/watches\/([a-f0-9-]{36})\/voice$/);
  if (req.method === 'GET' && voice) {
    const w = await getWatch(voice[1]);
    const audio = w && w.owner === owner ? await getVoice(w._id) : null;
    if (!audio) return send(res, 404, { error: 'no voice note' });
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' });
    return res.end(Buffer.from(audio));
  }

  // A free pinger (cron-job.org) calls this every 30 minutes; it wakes the server and runs whatever is due.
  // Answers right away and keeps working, so the pinger never times out.
  if (path === '/api/tick') {
    if (!TICK_SECRET || new URL(req.url, 'http://x').searchParams.get('key') !== TICK_SECRET) return send(res, 403, { error: 'no' });
    if (ticking) return send(res, 202, { already: true });
    ticking = true;
    tick()
      .then((log) => log.length && console.log(log.join('\n')))
      .catch((e) => console.error('tick', e))
      .finally(() => (ticking = false));
    return send(res, 202, { started: true });
  }

  return send(res, 404, { error: 'not found' });
}

async function file(res, path) {
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, '');
  if (rel.includes('..')) return send(res, 404, { error: 'not found' });
  try {
    const data = await readFile(join('public', rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) await api(req, res, path);
    else await file(res, path);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'something broke' });
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
