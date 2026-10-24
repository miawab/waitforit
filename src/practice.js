// A practice page that changes on its own, so anyone can watch the whole loop in a few minutes:
// before the time it says the doors open at HH:MM; after it, that they are open.
// The time lives in the link itself (?at=<ms>), so nothing is stored.

const HOUR = 3600e3;

// True for /practice links on this site (the Render host, or localhost while trying it on one PC).
export function isPractice(u) {
  const host = u.hostname;
  return u.pathname === '/practice' && (host === process.env.RENDER_EXTERNAL_HOSTNAME || host === 'localhost' || host === '127.0.0.1');
}

export function practicePage(u, now = new Date()) {
  const at = Number(u.searchParams.get('at'));
  // Only times close to now, so the link can't be used for anything else.
  if (!at || Math.abs(at - now) > 24 * HOUR) return null;
  const pkt = (d) => new Date(d).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
  const open = now >= at;
  const title = open ? 'Practice event: the doors are open' : 'Practice event: doors open soon';
  const body = open
    ? `The doors are now open! They opened at ${pkt(at)} (Pakistan time). Come on in.`
    : `The doors open at ${pkt(at)} (Pakistan time). They are not open yet. Please wait until then.`;
  const text = `${title}\n${body}\nThis is a practice page for Wait For It. It changes by itself at the time above, so you can see a watch wake up, read it again and tell you, without waiting days for something real.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:18px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;background:#f6f1e9;color:#2b2118}h1{font-size:1.6rem}</style></head>
<body><h1>${title}</h1><p>${body}</p><p>This is a practice page for Wait For It. It changes by itself at the time above, so you can see a watch wake up, read it again and tell you, without waiting days for something real.</p></body></html>`;
  return { title, text, html };
}
