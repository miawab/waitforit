// Tells the person: a browser notification, plus a voice note (ElevenLabs) when something really happened.
// No push keys or no subscription -> it just prints, which is enough to try it on one PC.
import webpush from 'web-push';
import { spend, CapReached } from './limits.js';
import { getPerson, setPerson, saveVoice } from './store.js';

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
      await saveVoice(watch._id, await speak(check.summary));
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

async function speak(text) {
  await spend('voice');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': EL },
    body: JSON.stringify({ text: text.slice(0, 300), model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`elevenlabs ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
