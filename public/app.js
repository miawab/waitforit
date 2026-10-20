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

const LABEL = { happened: 'Happened', changed: 'News', delayed: 'Delayed', nothing: 'Waiting', waiting: 'Waiting', stopped: 'Stopped', error: 'Error' };

function when(iso) {
  const ms = new Date(iso) - Date.now();
  const h = Math.round(Math.abs(ms) / 3600e3);
  const t = h < 1 ? 'under an hour' : h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`;
  return ms >= 0 ? `in ${t}` : `${t} ago`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function card(w) {
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
      <span>${real.length} check${real.length === 1 ? '' : 's'} (${gemmaRuns} read by Gemma)${w.active && w.nextCheckAt ? `, next ${when(w.nextCheckAt)}` : ''}${w.expected ? `, expected by ${w.expected}` : ''}</span>
      <span>${w.checks.some((c) => c.voice) ? `<button class="ghost" data-play="${w.id}">▶ Voice note</button> ` : ''}${w.active ? `<button class="ghost" data-stop="${w.id}">Stop</button>` : ''}</span>
    </div>
    <details class="hist"><summary>Every check</summary><ol>${w.checks
      .slice()
      .reverse()
      .map((c) => `<li><b>${LABEL[c.status] || c.status}</b> ${when(c.at)}${c.skipped ? ' (page unchanged, Gemma not needed)' : ''}: <span${dir}>${esc(c.summary)}</span></li>`)
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

async function load() {
  const watches = await api('/api/watches');
  $('#list').replaceChildren(...watches.map(card));
  payoff(watches);
}

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
  if (e.target.dataset?.play) return playVoice(e.target.dataset.play);
  const id = e.target.dataset?.stop;
  if (!id) return;
  await api(`/api/watches/${id}/stop`, { method: 'POST' });
  load();
});

// Notifications: a service worker shows them even when the tab is closed.
async function setupPush(key) {
  if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.register('sw.js');
  const existing = await reg.pushManager.getSubscription();
  if (existing && Notification.permission === 'granted') {
    await api('/api/push', { method: 'POST', body: JSON.stringify(existing) });
    return;
  }
  $('#tg').hidden = false;
  $('#pushbtn').onclick = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/api/push', { method: 'POST', body: JSON.stringify(sub) });
      $('#tg').hidden = true;
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
