# Wait For It

Tell it what you're waiting for. Stop checking.

> "Tell me when the results are out" + a link
> "Tell me when petrol prices change in Pakistan" (no link needed)

It looks rarely, on purpose. Each time it wakes up, **Gemma** (an open-weight model) reads the page or the latest search results and decides one thing: *has it happened, or changed, since I last told you?* Then it picks when to look next: once a week if the date is far away, every few hours when it's close. You only hear from it when there's real news.

## How it works

1. **A watch** = what you're waiting for, plus a link (or nothing, and it searches instead).
2. **A scheduled job** wakes up every 30 minutes and runs only the watches that are due.
3. **Each check**: fetch the page (skip Gemma entirely if the page hasn't changed) or search Google, then ask Gemma for `happened / changed / delayed / nothing`, a short summary, the expected date and hours until the next check.
4. **When there's news**: a Telegram message, and a voice note when it has actually happened.

## Run it on your own PC

Needs Node 20+. Nothing else is required to try it: without a database it saves to `data/store.json`.

```
npm install
# either: Gemma on your own machine (nothing leaves your PC)
ollama pull gemma4:e4b-it-qat   # then OLLAMA_URL=http://localhost:11434 in .env
# or: Gemma hosted on Google AI Studio
# GEMINI_API_KEY=... in .env

node src/cli.js "the winners are announced" https://example.com/results
node src/tick.js     # run whatever is due
```

Optional in `.env`: `SERPAPI_KEY` (watches without a link), `MONGODB_URI`, `TELEGRAM_BOT_TOKEN`, `ELEVENLABS_API_KEY`.

## Limits

Every service has a daily cap (`src/limits.js`) so free plans can't be used up: Gemma 400 calls, search 8, voice 15. At most 5 watches per person, never more often than every 30 minutes, never watching for more than 45 days.

## Credits

The Gemma calling code is adapted from my earlier project [scamcheck](https://github.com/miawab/scamcheck).

## License

MIT
