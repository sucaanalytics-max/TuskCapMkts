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

## Repo layout

```
exchange-pipeline/
├── dashboard/         # Vercel-served static dashboard + API routes
├── lib/               # Python shared modules (MCX config, cron handlers, API handler bodies)
├── scripts/           # Pipeline + poller + relay scripts
├── data/              # Pipeline JSON outputs (older layout)
├── .github/workflows/ # CI for daily updates + live polling
└── vercel.json        # Vercel deploy config
```
