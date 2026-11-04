# SIT Index

A daily price for a fixed amount of AI capability: the Standard Inference Token, after Yicai Xing's [AI Token Futures Market](https://arxiv.org/html/2603.21690) (2026). Every morning a scheduled function reads current list prices from OpenRouter and capability scores, computes three fixings and adds them to a record. The page shows the latest fixing, the history, and three scenarios projected from it.

| Fixing | What it prices |
| --- | --- |
| **SITB** | Fixed-capability work: models scoring 25–44, priced as if each scored 30 |
| **SITF** | Frontier work: models scoring 45 and above, priced as if each scored 55 |
| **SITC** | A basket: 70% SITB and 30% SITF by token count |

## What's in the project

```
public/index.html              The page (reads /api/fixings)
netlify/functions/
  daily-fixing.mjs             Runs at 06:00 UTC every day and writes the fixing
  fixings.mjs                  GET /api/fixings  and  /api/fixings?date=YYYY-MM-DD
  run-now.mjs                  POST /api/run to compute today's fixing on demand (needs ADMIN_TOKEN)
netlify/edge-functions/
  password.js                  Optional password for the whole site (SITE_PASSWORD)
lib/
  sit.mjs                      The calculation (method v0.1)
  sources.mjs                  OpenRouter prices, capability scores, matching models to prices
  run.mjs                      One daily run: gather, compute, store
  store.mjs                    Netlify Blobs storage
config/
  scores.json                  Fallback capability scores, used when AA_API_KEY isn't set
  weights.json                 Lab usage shares (OpenRouter rankings); update monthly
  aliases.json                 Manual model-name → OpenRouter id matches
  seed-fixing.json             The 3 Nov 2026 sample fixing, so the record doesn't start empty
test/run-test.mjs              Offline tests with fake API responses
```

## Deploy

1. **Put it on GitHub.** Create a new repository and push this folder to it.
2. **Create the Netlify site.** In Netlify: *Add new site → Import an existing project*, pick the repository. Netlify reads `netlify.toml`; there's no build step and the publish folder is `public`.
3. **Set environment variables** (*Site configuration → Environment variables*):

   | Variable | Needed | What it does |
   | --- | --- | --- |
   | `ADMIN_TOKEN` | Yes | Any long random string. Protects `/api/run`. |
   | `AA_API_KEY` | Recommended | Artificial Analysis API key, for live capability scores. Without it, `config/scores.json` is used. |
   | `SITE_PASSWORD` | Optional | Puts the whole site behind a password prompt (any username). |

4. **Deploy**, then **run the first fixing** instead of waiting for 06:00 UTC:

   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://YOUR-SITE.netlify.app/api/run
   ```

   The reply shows the fixing it wrote, including any models it couldn't price (`unmatched`). Add `?force=1` to recompute a day that already has a fixing.

5. **Check the schedule.** In Netlify, *Logs → Functions → daily-fixing* shows each run. The schedule is UTC: 06:00 UTC is 06:00 London in winter and 07:00 in summer. Change it in `netlify/functions/daily-fixing.mjs`.

Scheduled functions run only on the published site, not on deploy previews. They have a 30-second limit; a run takes a few seconds.

## Before making it public: the scores licence

The index is only as publishable as its capability scores.

- **Artificial Analysis free keys are for internal use only.** Their data can't be redistributed, and a public site showing derived numbers needs their commercial terms. Fine for a private, password-protected site; check their terms before going public.
- **`config/scores.json`** holds a snapshot taken from a third-party page. Treat it as a placeholder, not something to publish.
- For a public index, either license the scores or switch to a benchmark you're allowed to republish. Only `fetchScores` in `lib/sources.mjs` needs to change: it returns a list of `{model, lab, score}`.

OpenRouter's model list is public and needs no key.

## Keeping it accurate

- **Weights** (`config/weights.json`): OpenRouter has no public API for its rankings. Copy the "share by model author" figures from [openrouter.ai/rankings](https://openrouter.ai/rankings) once a month and redeploy.
- **Unmatched models**: if a scored model's name doesn't match OpenRouter's, the run uses Artificial Analysis's own price, then the previous fixing's, and lists it under `unmatched`. Add a line to `config/aliases.json` to fix the match.
- **Method changes**: everything lives in `METHOD` in `lib/sit.mjs`. Change the version string when you change the method, so old and new fixings can be told apart.
- **Large moves**: a move of more than 40% in SITB or SITF is still written, with a warning in the fixing's note.

## Run the tests

```bash
npm install
npm test
```

The tests use fake API responses and in-memory storage, so they need no keys or network. For a full local run with real storage, install the Netlify CLI and use `netlify dev`.

## Method (v0.1)

1. Every model with a capability score of 25 or more qualifies; where a benchmark lists several effort settings of one model, the highest score counts.
2. Price per model = (3 × input price + output price) ÷ 4, in USD per million tokens.
3. Price per SIT = that price × (tier anchor ÷ model score).
4. Each lab's weight is its usage share, capped at 30% of a tier, split evenly across its qualifying models.
5. Tier fixing = weighted average price per SIT. "Cheapest" = the lowest price per SIT in the tier.

Scenario paths on the page use Xing's mean-reverting jump-diffusion model, simulated in the browser from the latest fixing. They are illustrations, not forecasts.
