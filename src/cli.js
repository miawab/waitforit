import "./env.js";
// Add a watch from the terminal and run its first check right away.
//   node src/cli.js "the Week 2 winners are announced" https://dev.to/...
//   node src/cli.js "petrol prices change in Pakistan"
import { addWatch, close } from './store.js';
import { tick } from './tick.js';
import { searchQueryFor } from './agent.js';

const [ask, url] = process.argv.slice(2);
if (!ask) {
  console.log('usage: node src/cli.js "what you are waiting for" [link]');
  process.exit(1);
}
const query = url ? null : await searchQueryFor(ask);
if (query) console.log(`search query: ${query}`);
const w = await addWatch({ owner: 'cli', ask, url: url || null, query, lang: process.env.LANG_OUT || 'en', nextCheckAt: new Date().toISOString(), status: 'waiting' });
console.log(`watching ${w._id.slice(0, 8)}: ${ask}`);
console.log((await tick()).join('\n'));
await close();
