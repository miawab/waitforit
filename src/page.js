// Fetches a public page and turns it into plain text Gemma can read, plus the links on it.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 14_000;

export async function readPage(url) {
  // Follow redirects by hand: each hop must pass the same "public address only" check as the first link.
  let u = await safeUrl(url);
  let r;
  for (let hop = 0; ; hop++) {
    r = await fetch(u, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; waitforit/0.1; checks a page for one person)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    const next = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (!next) break;
    if (hop >= 5) throw new Error('too many redirects');
    u = await safeUrl(new URL(next, u).href);
  }
  if (!r.ok) throw new Error(`page returned ${r.status}`);
  const type = r.headers.get('content-type') || '';
  const raw = await readCapped(r);
  if (!/html|text|json|xml/.test(type)) return { text: '', links: [], hash: hash(raw), note: `not a web page (${type})` };
  const html = raw.toString('utf8');
  const text = htmlToText(html).slice(0, MAX_TEXT);
  return { title: (html.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim(), text, links: links(html, u), hash: hash(text) };
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function readCapped(r) {
  const chunks = [];
  let size = 0;
  for await (const c of r.body) {
    size += c.length;
    if (size > MAX_BYTES) break;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->|<![^>]*>/g, ' ')
    // Menus and footers eat the text budget before the real content starts.
    .replace(/<(script|style|noscript|svg|head|nav|footer|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, '\n')
    // A tag, skipping over quoted attributes (some sites put whole HTML snippets, with ">" in them, inside one).
    .replace(/<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = new URL(m[1], base).href;
      if (!/^https?:/.test(href)) continue;
      out.push({ href, text: htmlToText(m[2]).slice(0, 80) });
    } catch {}
    if (out.length >= 150) break;
  }
  return out;
}

// The server fetches pages people type in, so it must not be pointed at its own network.
export async function safeUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('not a valid link');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http and https links');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (ips.some(isPrivate)) throw new Error('that address is not public');
  return u.href;
}

function isPrivate(ip) {
  if (ip.includes(':')) return /^(::1?$|fc|fd|fe80|::ffff:(127|10|192\.168|169\.254)\.)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
