// Tells the person: a browser notification, plus a voice note (ElevenLabs) when something really happened.
// No push keys or no subscription -> it just prints, which is enough to try it on one PC.
import webpush from 'web-push';
import { spend, CapReached } from './limits.js';
import { getPerson, setPerson, saveVoice, getVoice } from './store.js';
import { isPractice } from './practice.js';

const EL = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
export const pushOn = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (pushOn()) webpush.setVapidDetails('mailto:noreply@waitforit.invalid', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const ICON = { happened: '✅', changed: '📝', delayed: '⏳', nothing: '👀' };

export async function notify(watch, check) {
  const title = `${ICON[check.status] || '👀'} ${watch.ask}`;
  const body = `${check.summary}${check.details?.length ? '\n' + check.details.join('\n') : ''}`;

  if (EL && (check.status === 'happened' || check.status === 'delayed')) {
    try {
      await saveVoice(watch._id, await voiceFor(watch, check));
      check.voice = true;
    } catch (e) {
      if (!(e instanceof CapReached)) console.error('voice', e.message);
    }
  }

  const person = await getPerson(watch.owner);
  const subs = person?.push || [];
  if (!pushOn() || !subs.length) {
    console.log(`[notify] ${title}: ${body.replace(/\n+/g, ' ')}${check.voice ? ' (voice note saved)' : ''}`);
    return 'printed';
  }
  const payload = JSON.stringify({ title, body, url: `/?watch=${watch._id}${check.voice ? '&play=1' : ''}`, tag: watch._id });
  const alive = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 86400 });
      alive.push(sub);
    } catch (e) {
      // 404/410: that browser unsubscribed. Anything else: keep it and try next time.
      if (e.statusCode !== 404 && e.statusCode !== 410) alive.push(sub), console.error('push', e.statusCode, e.body);
    }
  }
  if (alive.length !== subs.length) await setPerson(watch.owner, { push: alive });
  return alive.length ? 'push' : 'printed';
}

// Sent once, right when someone turns notifications on, so they know at once whether their browser shows them.
export async function confirmPush(sub) {
  if (!pushOn()) return false;
  const payload = JSON.stringify({ title: '✅ Notifications are on', body: "This is how you'll hear when something you're waiting for happens.", url: '/', tag: 'wfi-test' });
  try {
    await webpush.sendNotification(sub, payload, { TTL: 600 });
    return true;
  } catch (e) {
    console.error('push test', e.statusCode, e.body);
    return false;
  }
}

// Practice watches all say the same thing, so one saved voice note per language is reused: trying it costs no credits.
const PRACTICE_LINE = { en: 'The doors are open.', ur: 'دروازے کھل گئے ہیں۔' };
async function voiceFor(watch, check) {
  let practice = false;
  try {
    practice = isPractice(new URL(watch.url));
  } catch {}
  if (!practice) return speak(check.summary);
  const lang = watch.lang === 'ur' ? 'ur' : 'en';
  const saved = await getVoice(`practice-${lang}`);
  if (saved) return Buffer.from(saved);
  const audio = await speak(PRACTICE_LINE[lang]);
  await saveVoice(`practice-${lang}`, audio);
  return audio;
}

// ElevenLabs is the one plan that runs out for the month, so notes are kept to about one sentence.
async function speak(text) {
  await spend('voice');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': EL },
    body: JSON.stringify({ text: oneSentence(text, 150), model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`elevenlabs ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Up to the first sentence end within the limit, else cut at a word.
function oneSentence(text, max) {
  const t = String(text).trim();
  if (t.length <= max) return t;
  const end = Math.max(...['. ', '! ', '? ', '۔'].map((p) => t.lastIndexOf(p, max)));
  return end > 30 ? t.slice(0, end + 1) : t.slice(0, t.lastIndexOf(' ', max)) || t.slice(0, max);
}
