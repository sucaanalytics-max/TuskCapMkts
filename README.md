# exchange-pipeline

Unified pipeline + dashboard for NSE, BSE, and MCX.

This project consolidates two prior standalones:

- [`nse-cloud-pipeline`](https://github.com/Research-Tusk/nse-cloud-pipeline) — NSE + BSE pipelines, live pollers, dashboard.
- `MCX/mcx-vercel/` (private) — MCX standalone with local relay (`mcx_relay.py`) writing to MCX Supabase from a Mac via launchd (Akamai blocks cloud IPs).

Both originals remain deployed independently. This repo is the unified deep-dive view.

## Data sources

| Exchange | EOD | Live |
|---|---|---|
| NSE | Bhavcopy → Supabase | GitHub Actions poller every 5 min → `nse_live.json` |
| BSE | Bhavcopy → Supabase | GitHub Actions poller every 5 min → `bse_live.json` |
| MCX | External Supabase (`avqwpebveqetwwzkmtux`) | Local Mac relay → `mcx_snapshots` Supabase table (no static JSON) |

## Environment variables

Required in Vercel (Production + Preview + Development) and as GitHub Actions secrets:

- `SUPABASE_URL` — NSE/BSE Supabase project URL
- `SUPABASE_KEY` — NSE/BSE Supabase anon key
- `MCX_SUPABASE_URL` — MCX Supabase project URL (`https://avqwpebveqetwwzkmtux.supabase.co`)
- `MCX_SUPABASE_KEY` — MCX Supabase anon key
- `GITHUB_READ_PAT` — PAT for `/api/live` to proxy GitHub raw NSE/BSE live JSONs

See `.env.example`.

## Local relay (MCX)

`scripts/mcx_relay.py` runs on the user's Mac via `~/Library/LaunchAgents/com.mcx.relay.plist`. It bypasses the Akamai block on cloud IPs and writes intraday MCX snapshots directly to Supabase. The dashboard reads from Supabase, so the relay must stay running for live MCX data.

### Repointing the relay from MCX/mcx-vercel to exchange-pipeline (one-time)

Schedule this for **after Friday close** to avoid interrupting mid-session data.

1. Populate `.env` in this repo with `MCX_SUPABASE_URL` and `MCX_SUPABASE_KEY`.
2. Stop the running relay:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.mcx.relay.plist
   ```
3. Edit `~/Library/LaunchAgents/com.mcx.relay.plist`. Change two paths:
   - `ProgramArguments[1]` →
     `/Users/<you>/.../Documents/Working/exchange-pipeline/scripts/start_relay.sh`
   - `WorkingDirectory` →
     `/Users/<you>/.../Documents/Working/exchange-pipeline`
   Leave the schedule (08:55 IST Mon–Fri), `TimeOut` (54000s), and log paths alone.
4. Reload:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.mcx.relay.plist
   launchctl list | grep com.mcx.relay
   ```
5. Verify next trading morning by tailing `/tmp/mcx_relay_stdout.log`.
6. Optional cleanup: `com.mcx.daily-verify.plist` and `com.mcx.backtest.plist` reference scripts that don't exist in any repo any more — `launchctl unload` and `rm` if they're still around.

The standalone MCX repo (`MCX/mcx-vercel/`) keeps reading from the same Supabase, so its dashboard continues to work after the relay is repointed.

## Dashboard surface

| Exchange | Tabs |
|---|---|
| NSE | Revenue Summary, PAT Prediction Engine |
| BSE | Revenue Summary, Revenue Predictor, Regression |
| MCX | Revenue Summary, Daily Predictor, Commodities, Revenue Predictor, Regression |

`dashboard/live.html` (NSE/BSE only — MCX has no static live JSON, the MCX option redirects to the main dashboard's Daily Predictor tab).

## Vercel API surface

3 functions, 9 of headroom on Hobby's 12-function cap.

| Path | Purpose |
|---|---|
| `GET /api/live?exchange={nse,bse,mcx}&file={live,hourly,history,share,dashboard}` | Proxies GitHub raw NSE/BSE JSONs; MCX `file=live` short-circuits to Supabase |
| `GET /api/revenue` | NSE direct fetch + BSE direct fetch + MCX `mcx_snapshots` read → `{nse, bse, mcx, fetched_at}` |
| `GET /api/mcx?resource={refresh,history,price,commodities}` | Router into `lib/mcx_handlers/` |

## Repo layout

```
exchange-pipeline/
├── dashboard/         # Vercel-served static dashboard + API routes
│   ├── api/{live.js, revenue.js, mcx.py}
│   ├── {index,live}.html
│   ├── app.js, mcx-predictor.js, mcx-commodities.js
│   └── data/          # JSON outputs committed by workflows
├── lib/               # Python shared modules
│   ├── mcx_config.py, cron_commodity_signals.py
│   └── mcx_handlers/  # extracted handler bodies (refresh/history/price/commodities)
├── scripts/           # Pipeline + poller + relay scripts
├── data/              # Pipeline JSON outputs (older layout, for back-compat)
├── .github/workflows/ # CI for daily updates + NSE/BSE live polling
└── vercel.json        # Vercel deploy config
```

## One-time manual setup

The repo is functional locally. Before deploying:

1. **Create GitHub repo** — `Research-Tusk/exchange-pipeline` (private). Push the local `main` branch:
   ```bash
   cd Working/exchange-pipeline
   git remote add origin git@github.com:Research-Tusk/exchange-pipeline.git
   git push -u origin main
   ```
   (the gh CLI auth on this machine couldn't create under `Research-Tusk` — needs an account with org write access)

2. **Create Vercel project** linked to the GitHub repo. Output directory: `dashboard`. Add all five env vars from "Environment variables" above to Production, Preview, and Development.

3. **Add GitHub Actions secrets**: same five plus `VERCEL_DEPLOY_HOOK`.

4. **One-time MCX share-price backfill** (for the Regression tab):
   ```bash
   source .env && export $(grep -v '^#' .env | xargs)
   python scripts/mcx_price_refresh.py --backfill 600
   python scripts/mcx_share_analysis.py
   git add dashboard/data/mcx_share_analysis.json
   git commit -m "📈 MCX share analysis: initial backfill"
   git push
   ```

5. **Repoint MCX relay** (after Friday close — see "Repointing the relay" above).

## Architectural notes

- **NSE/BSE-vs-MCX asymmetry**: NSE/BSE live data is polled by GitHub Actions and committed to `dashboard/data/*_live.json`. MCX is Akamai-blocked from cloud, so the local Mac relay writes `mcx_snapshots` to Supabase, and `/api/mcx?resource=refresh` reads from there. No `mcx_live.json` is materialised on disk.
- **Function consolidation**: 5 MCX serverless functions from `MCX/mcx-vercel/` collapse into one `/api/mcx?resource=...` router in `dashboard/api/mcx.py`. Lazy-imports keep cold start light.
- **Dual Supabase**: NSE/BSE Supabase (env `SUPABASE_*`) and MCX Supabase (env `MCX_SUPABASE_*`) are read in parallel; the two are intentionally not consolidated to keep the standalone repos deployable.
