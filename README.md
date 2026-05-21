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
