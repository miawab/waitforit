// The page: add a watch, see what it found, stop it. Your id lives only in this browser.
const $ = (s) => document.querySelector(s);

let owner;
try {
  owner = localStorage.getItem('wfi-owner');
  if (!owner) localStorage.setItem('wfi-owner', (owner = crypto.randomUUID()));
} catch {
  owner = crypto.randomUUID();
}

const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'x-owner': owner } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `error ${r.status}`);
  return data;
};

const MODEL = (m) => (!m ? '' : /gemma/i.test(m) ? 'Gemma' : `${m.split('/').pop()} on Groq`);
const LABEL = { happened: 'Happened', changed: 'News', delayed: 'Delayed', nothing: 'Waiting', waiting: 'Waiting', stopped: 'Stopped', error: 'Error' };

function when(iso) {
  const ms = new Date(iso) - Date.now();
  const m = Math.round(Math.abs(ms) / 60e3);
  const h = Math.round(Math.abs(ms) / 3600e3);
  const t = m < 1 ? 'under a minute' : m < 60 ? `${m} min` : h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`;
  return ms >= 0 ? `in ${t}` : `${t} ago`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function card(w, readOnly = false) {
  const real = w.checks.filter((c) => c.status !== 'error');
  const latest = [...real].reverse().find((c) => c.status !== 'nothing') || real.at(-1);
  const status = w.active ? (latest?.status === 'nothing' || !latest ? 'waiting' : latest.status) : w.status;
  const dir = w.lang === 'ur' ? ' dir="rtl" lang="ur"' : '';
  const gemmaRuns = real.filter((c) => !c.skipped).length;
  const li = document.createElement('li');
  li.dataset.id = w.id;
  li.innerHTML = `
    <span class="chip ${status}">${LABEL[status] || status}</span>
    <h2>${esc(w.ask)}</h2>
    <p class="where">${w.url ? esc(w.url) : `Searching the news for “${esc(w.query)}”`}</p>
    ${latest ? `<p class="latest"${dir}>${esc(latest.summary)}</p>` : ''}
    ${latest?.details?.length ? `<ul class="details"${dir}>${latest.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    ${w.files.length ? `<p class="files">📎 ${w.files.map((f) => `<a href="${esc(f.href)}" target="_blank" rel="noopener">${esc(f.name || 'file')}</a>`).join(', ')}</p>` : ''}
    <div class="meta">
      <span>${real.length} check${real.length === 1 ? '' : 's'} (${gemmaRuns} read by the AI)${w.active && w.nextCheckAt ? `, next ${when(w.nextCheckAt)}` : ''}${w.expected ? `, expected by ${w.expected}` : ''}</span>
      <span>${readOnly ? '' : `${w.checks.some((c) => c.voice) ? `<button class="ghost" data-play="${w.id}">▶ Voice note</button> ` : ''}${w.active ? `<button class="ghost" data-stop="${w.id}">Stop</button> ` : ''}<button class="ghost" data-remove="${w.id}">Remove</button>`}</span>
    </div>
    <details class="hist"><summary>Every check</summary><ol>${w.checks
      .slice()
      .reverse()
      .map((c) => `<li><b>${LABEL[c.status] || c.status}</b> ${when(c.at)}${c.skipped ? ' (page unchanged, no AI needed)' : c.model ? ` (${esc(MODEL(c.model))})` : ''}: <span${dir}>${esc(c.summary)}</span></li>`)
      .join('')}</ol></details>`;
  return li;
}

// The lazy payoff: how often you'd have refreshed (once an hour, 16 waking hours a day) vs how often it looked.
function payoff(watches) {
  if (!watches.length) return ($('#payoff').hidden = true);
  const hours = watches.reduce((s, w) => s + (Date.now() - new Date(w.createdAt)) / 3600e3, 0);
  const you = Math.max(1, Math.round((hours * 16) / 24));
  const it = watches.reduce((s, w) => s + w.checks.filter((c) => c.status !== 'error').length, 0);
  // Only worth saying once it has saved you something.
  $('#payoff').hidden = you <= it;
  $('#payoff').innerHTML = `Refreshing every hour you're awake, you'd have checked <b>${you}</b> times. It checked <b>${it}</b>. You checked <b>0</b>.`;
}

let refresh;
async function load() {
  const [watches, examples] = await Promise.all([api('/api/watches'), api('/api/examples').catch(() => [])]);
  $('#list').replaceChildren(...watches.map((w) => card(w)));
  $('#empty').hidden = watches.length > 0;
  $('#examples').hidden = !examples.length;
  $('#exlist').replaceChildren(...examples.map((w) => card(w, true)));
  payoff(watches);
  // Keep the list fresh while the page is open: every 15 seconds when a check is due soon, else every 2 minutes.
  const soon = watches.some((w) => w.active && w.nextCheckAt && new Date(w.nextCheckAt) - Date.now() < 15 * 60e3);
  clearTimeout(refresh);
  refresh = setTimeout(() => document.visibilityState === 'visible' ? load().catch(() => {}) : null, soon ? 15e3 : 120e3);
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load().catch(() => {}));

// Practice: a page on this site whose doors open in a few minutes, to see the whole loop without waiting days.
$('#practice').addEventListener('click', (e) => {
  const mins = Number(e.target.dataset?.mins);
  if (!mins) return;
  const f = $('#add');
  f.ask.value = 'the doors open';
  f.url.value = `${location.origin}/practice?at=${Date.now() + mins * 60e3}`;
  f.requestSubmit();
});

$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#err').textContent = '';
  $('#go').disabled = true;
  $('#go').textContent = 'Reading it…';
  try {
    await api('/api/watches', { method: 'POST', body: JSON.stringify({ ask: f.get('ask'), url: f.get('url') || null, lang: f.get('lang') }) });
    e.target.reset();
    await load();
  } catch (err) {
    $('#err').textContent = err.message;
  } finally {
    $('#go').disabled = false;
    $('#go').textContent = 'Wait for it';
  }
});

$('#list').addEventListener('click', async (e) => {
  const { play, stop, remove } = e.target.dataset || {};
  if (play) return playVoice(play);
  if (stop) {
    await api(`/api/watches/${stop}/stop`, { method: 'POST' });
    return load();
  }
  if (!remove) return;
  // Two taps, so a stray one doesn't delete a watch and its history.
  if (!e.target.classList.contains('sure')) {
    e.target.classList.add('sure');
    e.target.textContent = 'Tap again to remove';
    return setTimeout(() => e.target.isConnected && (e.target.classList.remove('sure'), (e.target.textContent = 'Remove')), 4000);
  }
  await api(`/api/watches/${remove}/remove`, { method: 'POST' });
  load();
});

// Notifications: a service worker shows them even when the tab is closed.
async function setupPush(key) {
  if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.register('sw.js');
  const existing = await reg.pushManager.getSubscription();
  // Already on: offer a test, since a blocked Windows/phone setting hides notifications without any error here.
  const test = async (sub) => {
    const r = await api('/api/push', { method: 'POST', body: JSON.stringify({ ...sub.toJSON(), test: true }) });
    $('#pushok').hidden = false;
    $('#pushok').textContent = r.sent
      ? "Sent a test notification. Didn't see it? Check that notifications for your browser are on in your computer's or phone's settings, and Do Not Disturb is off."
      : "Couldn't send a test notification. Try turning notifications off and on again for this site.";
  };
  if (existing && Notification.permission === 'granted') {
    await api('/api/push', { method: 'POST', body: JSON.stringify(existing) });
    $('#pushtest').hidden = false;
    $('#pushtest').onclick = () => test(existing).catch((e) => ($('#pushok').textContent = e.message));
    return;
  }
  $('#tg').hidden = false;
  $('#pushbtn').onclick = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await test(sub);
      $('#tg').hidden = true;
      $('#pushtest').hidden = false;
      $('#pushtest').onclick = () => test(sub).catch((e) => ($('#pushok').textContent = e.message));
    } catch (e) {
      $('#pushmsg').textContent = e.message;
    }
  };
}

api('/api/config').then((c) => setupPush(c.push)).catch(() => {});

// Opened from a notification: jump to that watch and offer its voice note.
async function playVoice(id) {
  const r = await fetch(`/api/watches/${id}/voice`, { headers: { 'x-owner': owner } });
  if (!r.ok) return;
  const audio = new Audio(URL.createObjectURL(await r.blob()));
  audio.play().catch(() => {});
  return audio;
}

const params = new URLSearchParams(location.search);
load()
  .then(() => {
    const id = params.get('watch');
    if (!id) return;
    document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' });
    if (params.get('play')) playVoice(id);
  })
  .catch((e) => ($('#err').textContent = e.message));
