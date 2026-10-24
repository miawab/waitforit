// Loads .env into process.env (without overwriting anything already set). Imported first by every entry point.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import webpush from 'web-push';

try {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

// On your own PC (not on Render), browser notifications work without setup: a key pair is made once and kept in data/.
if (!process.env.RENDER && !(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)) {
  let keys;
  try {
    keys = JSON.parse(readFileSync('data/vapid.json', 'utf8'));
  } catch {
    keys = webpush.generateVAPIDKeys();
    mkdirSync('data', { recursive: true });
    writeFileSync('data/vapid.json', JSON.stringify(keys));
  }
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}
