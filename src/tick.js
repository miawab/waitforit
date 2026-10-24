import "./env.js";
// Wakes up, runs every watch that is due, saves the results, and tells people about real news.
// Runs on a schedule (GitHub Actions) or by hand: `node src/tick.js`.
import { dueWatches, recordCheck, updateWatch, getWatch, close } from './store.js';
import { checkWatch } from './agent.js';
import { notify } from './notify.js';
import { CAPS, tickBudgetUsed } from './limits.js';

// One check of one watch, saved, with a message if there's news. Errors are left to the caller.
export async function runWatch(w, now = new Date()) {
  const c = await checkWatch(w, now);
  const tooOld = now - new Date(w.createdAt) > CAPS.maxDaysWatching * 86400e3;
  const patch = { nextCheckAt: c.nextCheckAt, lastHash: c.hash, lastInterval: c.interval || w.lastInterval };
  if (c.expected) patch.expected = c.expected;
  if (c.expectedAt !== undefined && !c.skipped) patch.expectedAt = c.expectedAt;
  // "Tell me when the price changes" never ends after one change, whatever Gemma says.
  const again = /chang|every|whenever|any new|goes (up|down)|drops?\b|بدل/i.test(w.ask);
  if (again) c.done = false;
  if (c.status === 'happened' && !again) patch.status = 'happened';
  if (c.done || tooOld) Object.assign(patch, { active: false, status: c.done ? 'happened' : 'stopped' });
  if (c.files?.length) patch.files = [...(w.files || []), ...c.files.map((f) => ({ ...f, foundAt: c.at, saved: false }))];
  if (c.status !== 'nothing' || c.first) c.notified = await notify(w, c);
  await recordCheck(w._id, c, patch);
  if (patch.active !== false) wakeSoon(w._id, c.nextCheckAt);
  return c;
}

// The schedule pings /api/tick every 30 minutes, which is too slow for "due in 2 minutes".
// So the web server also sets a timer for anything due soon. Only short ones: a free Render
// service goes to sleep after 15 quiet minutes, and the next tick picks up anything missed.
const timers = new Map();
let timersOn = false;
export const useTimers = () => (timersOn = true);

function wakeSoon(id, at) {
  const ms = new Date(at) - Date.now();
  if (!timersOn || ms > 14 * 60e3) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(async () => {
    timers.delete(id);
    try {
      const w = await getWatch(id);
      if (w?.active && new Date(w.nextCheckAt) <= new Date()) await runWatch(w);
    } catch (e) {
      console.error('timer', id.slice(0, 8), e.message);
    }
  }, Math.max(0, ms)));
}

export async function tick(now = new Date()) {
  const log = [];
  for (const w of await dueWatches(now)) {
    if (await tickBudgetUsed()) {
      // Leave the rest of today's AI calls for new visitors; this watch just waits a few hours.
      await updateWatch(w._id, { nextCheckAt: new Date(now.getTime() + 4 * 3600e3).toISOString() });
      log.push(`${w._id.slice(0, 8)} deferred: background share of today's AI calls used`);
      continue;
    }
    try {
      const c = await runWatch(w, now);
      log.push(`${w._id.slice(0, 8)} ${c.status}${c.skipped ? ' (skipped)' : ''}: ${c.summary}`);
    } catch (e) {
      // A cap or a broken page shouldn't stop the other watches. Try again later.
      const retry = new Date(now.getTime() + (e.name === 'CapReached' || e.outage ? 12 : 3) * 3600e3).toISOString();
      const summary = e.outage ? "couldn't check: the AI's free quota is used up, trying again later" : e.message.slice(0, 200);
      await recordCheck(w._id, { at: now.toISOString(), status: 'error', summary }, { nextCheckAt: retry });
      log.push(`${w._id.slice(0, 8)} error: ${e.message}`);
    }
  }
  // Anything due before the next ping gets a timer, so "a minute after 3 PM" isn't half an hour late.
  if (timersOn) for (const w of await dueWatches(new Date(now.getTime() + 14 * 60e3))) wakeSoon(w._id, w.nextCheckAt);
  return log;
}

if (process.argv[1]?.endsWith('tick.js')) {
  const log = await tick();
  console.log(log.length ? log.join('\n') : 'nothing due');
  await close();
}
