// Where watches and their check history live.
// MONGODB_URI set -> MongoDB Atlas (needed once the checks run in the cloud).
// Not set         -> data/store.json, so the whole thing runs on one PC with no accounts.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const URI = process.env.MONGODB_URI;
let db; // mongo db handle, or the parsed json file

async function open() {
  if (db) return db;
  if (URI) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(URI);
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'waitforit');
    db.close = () => client.close();
  } else {
    try {
      db = JSON.parse(await readFile('data/store.json', 'utf8'));
    } catch {
      db = { watches: [], counters: {} };
    }
  }
  return db;
}

async function saveFile() {
  if (URI) return;
  await mkdir('data', { recursive: true });
  await writeFile('data/store.json', JSON.stringify(db, null, 2));
}

export async function close() {
  if (URI && db) await db.close();
  db = undefined;
}

export async function addWatch(w) {
  const d = await open();
  const watch = { _id: randomUUID(), createdAt: new Date().toISOString(), checks: [], active: true, ...w };
  if (URI) await d.collection('watches').insertOne(watch);
  else d.watches.push(watch), await saveFile();
  return watch;
}

export async function getWatch(id) {
  const d = await open();
  return URI ? d.collection('watches').findOne({ _id: id }) : d.watches.find((w) => w._id === id) || null;
}

// Watches marked example: true (set by hand in the database) are shown to every visitor, read-only.
export async function listExamples() {
  const d = await open();
  if (URI) return d.collection('watches').find({ example: true }).sort({ createdAt: -1 }).limit(4).toArray();
  return d.watches.filter((w) => w.example).reverse().slice(0, 4);
}

export async function listWatches(owner) {
  const d = await open();
  if (URI) return d.collection('watches').find({ owner }).sort({ createdAt: -1 }).toArray();
  return d.watches.filter((w) => w.owner === owner).reverse();
}

export async function dueWatches(now = new Date()) {
  const d = await open();
  const iso = now.toISOString();
  if (URI) return d.collection('watches').find({ active: true, nextCheckAt: { $lte: iso } }).toArray();
  return d.watches.filter((w) => w.active && w.nextCheckAt <= iso);
}

export async function countActive(owner) {
  const d = await open();
  const q = owner ? { active: true, owner } : { active: true };
  if (URI) return d.collection('watches').countDocuments(q);
  return d.watches.filter((w) => w.active && (!owner || w.owner === owner)).length;
}

// Saves the result of one check and keeps the last 50 in the history.
export async function recordCheck(id, check, patch) {
  const d = await open();
  if (URI) {
    await d.collection('watches').updateOne({ _id: id }, { $set: patch, $push: { checks: { $each: [check], $slice: -50 } } });
  } else {
    const w = d.watches.find((x) => x._id === id);
    Object.assign(w, patch);
    w.checks = [...w.checks, check].slice(-50);
    await saveFile();
  }
}

export async function removeWatch(id) {
  const d = await open();
  if (URI) await Promise.all([d.collection('watches').deleteOne({ _id: id }), d.collection('voices').deleteOne({ _id: id })]);
  else (d.watches = d.watches.filter((w) => w._id !== id)), d.voices && delete d.voices[id], await saveFile();
}

export async function updateWatch(id, patch) {
  const d = await open();
  if (URI) await d.collection('watches').updateOne({ _id: id }, { $set: patch });
  else Object.assign(d.watches.find((x) => x._id === id) || {}, patch), await saveFile();
}

// A person is just the random id their browser made, plus the browsers they turned notifications on in.
export async function getPerson(owner) {
  const d = await open();
  if (URI) return d.collection('people').findOne({ _id: owner });
  return d.people?.[owner] ? { _id: owner, ...d.people[owner] } : null;
}

export async function setPerson(owner, patch) {
  const d = await open();
  if (URI) return d.collection('people').updateOne({ _id: owner }, { $set: patch }, { upsert: true });
  d.people = d.people || {};
  d.people[owner] = { ...d.people[owner], ...patch };
  await saveFile();
}

// The latest voice note for a watch (one per watch, replaced each time).
export async function saveVoice(id, buf) {
  const d = await open();
  if (URI) return d.collection('voices').updateOne({ _id: id }, { $set: { audio: buf, at: new Date() } }, { upsert: true });
  d.voices = d.voices || {};
  d.voices[id] = buf.toString('base64');
  await saveFile();
}

export async function getVoice(id) {
  const d = await open();
  if (URI) return (await d.collection('voices').findOne({ _id: id }))?.audio?.buffer || null;
  return d.voices?.[id] ? Buffer.from(d.voices[id], 'base64') : null;
}

// Reads a named counter without changing it.
export async function peek(key) {
  const d = await open();
  if (URI) return (await d.collection('counters').findOne({ _id: key }))?.n || 0;
  return d.counters[key] || 0;
}

// Adds 1 to a named counter and returns the new value.
export async function bump(key) {
  const d = await open();
  if (URI) {
    const r = await d.collection('counters').findOneAndUpdate({ _id: key }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' });
    return r.n;
  }
  d.counters[key] = (d.counters[key] || 0) + 1;
  await saveFile();
  return d.counters[key];
}
