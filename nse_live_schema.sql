-- ============================================================
-- NSE Live Snapshots — Supabase Schema
-- Run in Supabase Dashboard → SQL Editor
-- Stores 5-min market snapshots from GitHub Actions poller
-- ============================================================

CREATE TABLE IF NOT EXISTS nse_live_snapshots (
    id            SERIAL PRIMARY KEY,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    market_status JSONB,          -- raw /api/marketStatus response
    raw_turnover  JSONB,          -- raw /api/market-turnover response (null when closed)
    revenue       JSONB,          -- computed revenue dict
    has_data      BOOLEAN DEFAULT false   -- true when turnover fields were mapped
);

-- Fast lookup of recent snapshots for the live dashboard
CREATE INDEX IF NOT EXISTS idx_nse_live_captured_at
    ON nse_live_snapshots (captured_at DESC);

-- ============================================================
-- Optional: auto-purge rows older than 90 days
-- (run as a scheduled Supabase pg_cron job or manually)
-- ============================================================
-- SELECT cron.schedule(
--   'purge-old-live-snapshots',
--   '0 2 * * *',
--   $$DELETE FROM nse_live_snapshots WHERE captured_at < now() - interval '90 days'$$
-- );

-- ============================================================
-- Row Level Security — enable if Supabase anon key is public
-- ============================================================
-- ALTER TABLE nse_live_snapshots ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Public read" ON nse_live_snapshots FOR SELECT USING (true);
