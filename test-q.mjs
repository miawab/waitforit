import './src/env.js';
import { searchQueryFor } from './src/agent.js';
for (let i = 0; i < 5; i++) { const t = Date.now(); try { console.log(await searchQueryFor('پاکستان میں پٹرول کی قیمت بدل جائے'), (Date.now()-t)/1000); } catch (e) { console.log('FAIL', e.message); } }
