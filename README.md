# Wait For It

Tell it what you're waiting for. Stop checking.

> "Tell me when the results are out" + a link
> "Tell me when petrol prices change in Pakistan" (no link needed)

It looks rarely, on purpose. Each time it wakes up, **Gemma** (an open-weight model; an open-weight gpt-oss model on Groq stands in if Gemma's hosted quota runs out) reads the page or the latest search results and decides one thing: *has it happened, or changed, since I last told you?* Then it picks when to look next: once a week if the date is far away, every few hours when it's close. You only hear from it when there's real news.

## How it works

1. **A watch** = what you're waiting for, plus a link (or nothing, and it searches instead).
2. **A free pinger** (like cron-job.org) calls `/api/tick` every few minutes; the server runs only the watches that are due. When a page names an exact time, it wakes up a minute after it.
3. **Each check**: fetch the page (skip Gemma entirely if the page hasn't changed) or search Google, then ask Gemma for `happened / changed / delayed / nothing`, a short summary, the expected date and hours until the next check.
4. **When there's news**: a browser notification (works with the tab closed), and a voice note when it has actually happened or been delayed. English or Urdu.

## Run it on your own PC

Everything runs on one PC with no accounts: Gemma through [Ollama](https://ollama.com), watches saved in `data/store.json`, notifications in your browser. Needs Node 22+ and Ollama.

```
git clone https://github.com/miawab/waitforit.git
cd waitforit
npm install
ollama pull gemma4:e4b-it-qat     # Gemma, about 6 GB; a 6 GB graphics card is enough
cp .env.example .env              # already points at Ollama on this PC
npm start                         # open http://localhost:3000
```

Then press **2 min** under the form: it watches a practice page whose "doors open" in two minutes, wakes up a minute after, and tells you. Turn on notifications first to get the alert with the tab closed.

On your own PC the server checks for due watches every minute by itself, and makes its own notification keys (kept in `data/`). Gemma on a home graphics card takes from a few seconds (short pages) to a minute or two (long pages) per check.

No graphics card? Put a free `GROQ_API_KEY` (an open-weight model, gpt-oss-120b) or a `GEMINI_API_KEY` in `.env` instead of `OLLAMA_URL`. Optional: `SERPAPI_KEY` for watches without a link, `ELEVENLABS_API_KEY` for voice notes. See `.env.example`.

From the terminal instead of the page:

```
node src/cli.js "the winners are announced" https://example.com/results
node src/tick.js     # run whatever is due
```

## Put it online

`render.yaml` describes one free Render web service. Create it from the repo, paste the secrets it asks for, then point a free pinger at `https://<your-app>/api/tick?key=<TICK_SECRET>` every 5 minutes. The ping also wakes the free server up, so nothing has to stay on.

## Limits

Free plans only, so every service has a cap (`src/limits.js`): per day, 400 Gemma calls, 300 Groq calls, 8 searches and 8 voice notes, and background checks leave 30% of each for people trying the site. At most 5 watches per person, 10 new ones per address a day, never more often than every 30 minutes (except right around an exact time it was told), never watching for more than 45 days. Nonsense is turned away before it costs anything, and a watch that finds nothing about itself 5 times in a row stops.

## Credits

The Gemma calling code is adapted from my earlier project [scamcheck](https://github.com/miawab/scamcheck).

## License

MIT
