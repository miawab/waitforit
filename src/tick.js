import "./env.js";
// Wakes up, runs every watch that is due, saves the results, and tells people about real news.
// Runs on a schedule (GitHub Actions) or by hand: `node src/tick.js`.
import { dueWatches, recordCheck, close } from './store.js';
import { checkWatch } from './agent.js';
import { notify } from './notify.js';
import { CAPS, CapReached } from './limits.js';

export async function tick(now = new Date()) {
  const due = await dueWatches(now);
  const log = [];
  for (const w of due) {
    try {
      const c = await checkWatch(w, now);
      const tooOld = now - new Date(w.createdAt) > CAPS.maxDaysWatching * 86400e3;
      const patch = { nextCheckAt: c.nextCheckAt, lastHash: c.hash, lastInterval: c.interval || w.lastInterval };
      if (c.expected) patch.expected = c.expected;
      if (c.status === 'happened') patch.status = 'happened';
      if (c.done || tooOld) Object.assign(patch, { active: false, status: c.done ? 'happened' : 'stopped' });
      if (c.files?.length) patch.files = [...(w.files || []), ...c.files.map((f) => ({ ...f, foundAt: c.at, saved: false }))];
      if (c.status !== 'nothing' || c.first) c.notified = await notify(w, c);
      await recordCheck(w._id, c, patch);
      log.push(`${w._id.slice(0, 8)} ${c.status}${c.skipped ? ' (skipped)' : ''}: ${c.summary}`);
    } catch (e) {
      // A cap or a broken page shouldn't stop the other watches. Try again in a few hours.
      const retry = new Date(now.getTime() + (e instanceof CapReached ? 12 : 3) * 3600e3).toISOString();
      await recordCheck(w._id, { at: now.toISOString(), status: 'error', summary: e.message.slice(0, 200) }, { nextCheckAt: retry });
      log.push(`${w._id.slice(0, 8)} error: ${e.message}`);
    }
  }
  return log;
}

if (process.argv[1]?.endsWith('tick.js')) {
  const log = await tick();
  console.log(log.length ? log.join('\n') : 'nothing due');
  await close();
}
