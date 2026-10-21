# Does Gemma know when it has happened?

36 real pages (release pages, Wikipedia, GitHub releases), each with a question like "Python 3.16 is released" and an answer I checked by hand on that page on 2026-10-21. Half are pairs on the same page (Linux 7.3 out, 7.4 not yet), so the page is full of the right words either way. Pages are saved once to `data/eval/` so every run reads the same text.

`node eval/run.mjs` runs Wait For It's real check (`checkWatch`, including the quote check) on each one, next to a keyword rule that fires when a done-sounding word ("released", "announced", "won", ...) is on the page, which is what a "tell me when the page changes" alert does.

| 36 pages | correct | false alarms | missed |
|---|---|---|---|
| Gemma 4 (26B A4B) + quote check | 35 | 0 | 1 |
| keyword rule | 18 | 15 | 3 |

What went wrong along the way:

- **Missed: Artemis II.** The page says it launched on April 1, 2026 and landed April 11. Gemma read "launch date April 1, 2026" as a plan and said it hadn't happened yet, even though today was in the prompt.
- **One label was mine and wrong.** I marked "Firefox 158 is out" as not yet; Gemma said it was out and it was (158.0 and 158.0.1 are listed). Fixed the label and added Firefox 159 as the "not yet" case.
- **The quote check was too strict twice**: it refused "158.0" (too short) and a quote with "..." joining two sentences. Both were true. Version numbers and quotes with gaps now count when every piece is on the page.
- **Before any of that, most calls failed** with 429: the free tier allows only so many tokens a minute, and these pages are long (8,000 to 13,000 tokens each). The app now waits as long as Google asks and carries on, so a run takes about a minute per page.
