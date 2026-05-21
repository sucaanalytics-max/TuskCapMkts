-- ============================================================
-- BSE Trading Data — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Daily trading data (source of truth)
CREATE TABLE IF NOT EXISTS bse_daily (
    date                        DATE PRIMARY KEY,
    day                         TEXT NOT NULL,
    fy_quarter                  TEXT NOT NULL,
    fy_month                    TEXT NOT NULL,
    fy                          TEXT NOT NULL,
    -- F&O raw data
    total_contracts             BIGINT DEFAULT 0,
    total_turnover              NUMERIC DEFAULT 0,
    futures_turnover            NUMERIC DEFAULT 0,
    options_notional_turnover   NUMERIC DEFAULT 0,
    options_premium_turnover    NUMERIC DEFAULT 0,
    -- Computed revenue (Cr)
    fut_rev                     NUMERIC DEFAULT 0,
    opt_rev                     NUMERIC DEFAULT 0,
    fo_rev                      NUMERIC DEFAULT 0,
    -- Cash
    cash_traded_value           NUMERIC DEFAULT 0,
    cash_securities             INT DEFAULT 0,
    cash_trades                 INT DEFAULT 0,
    cash_quantity               BIGINT DEFAULT 0,
    cash_rev                    NUMERIC DEFAULT 0,
    -- Totals
    total_rev                   NUMERIC DEFAULT 0,
    -- Ratios
    pn_ratio                    NUMERIC DEFAULT 0,
    -- Metadata
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

-- 2. Pre-computed aggregates (JSONB blobs for fast dashboard reads)
CREATE TABLE IF NOT EXISTS bse_aggregates (
    key         TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. Pipeline run log
CREATE TABLE IF NOT EXISTS bse_pipeline_runs (
    id              SERIAL PRIMARY KEY,
    run_date        TIMESTAMPTZ DEFAULT now(),
    new_days_added  INT DEFAULT 0,
    latest_date     DATE,
    status          TEXT DEFAULT 'success',
    details         TEXT,
    source          TEXT DEFAULT 'github_actions'
);

-- ============================================================
-- Indexes for common queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bse_daily_fy_quarter ON bse_daily(fy_quarter);
CREATE INDEX IF NOT EXISTS idx_bse_daily_fy_month ON bse_daily(fy_month);
CREATE INDEX IF NOT EXISTS idx_bse_daily_fy ON bse_daily(fy);

-- ============================================================
-- Trigger: auto-update updated_at on bse_daily
-- ============================================================
CREATE TRIGGER update_bse_daily_modtime
    BEFORE UPDATE ON bse_daily
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
