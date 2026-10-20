// Tells the person: a Telegram message, plus a voice note (ElevenLabs) when something really happened.
// Neither set up -> it just prints, which is enough to try it on one PC.
import { spend, CapReached } from './limits.js';

const TG = process.env.TELEGRAM_BOT_TOKEN;
const EL = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';

const ICON = { happened: '✅', changed: '📝', delayed: '⏳', nothing: '👀' };

export async function notify(watch, check) {
  const text = `${ICON[check.status] || '👀'} ${watch.ask}\n\n${check.summary}${check.details?.length ? '\n• ' + check.details.join('\n• ') : ''}${check.files?.length ? `\n\n📎 ${check.files.length} file(s) found` : ''}`;
  if (!TG || !watch.telegramChat) {
    console.log(`[notify] ${text.replace(/\n+/g, ' ')}`);
    return 'printed';
  }
  await telegram('sendMessage', { chat_id: watch.telegramChat, text, disable_web_page_preview: true });
  if (EL && (check.status === 'happened' || check.status === 'delayed')) {
    try {
      const audio = await speak(check.summary);
      const form = new FormData();
      form.set('chat_id', String(watch.telegramChat));
      form.set('audio', new Blob([audio], { type: 'audio/mpeg' }), 'update.mp3');
      form.set('title', 'Wait For It');
      await fetch(`https://api.telegram.org/bot${TG}/sendAudio`, { method: 'POST', body: form });
      return 'telegram+voice';
    } catch (e) {
      if (!(e instanceof CapReached)) console.error('voice', e.message);
    }
  }
  return 'telegram';
}

export async function telegram(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
  return data.result;
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
