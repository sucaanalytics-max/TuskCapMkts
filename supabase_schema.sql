-- ============================================================
-- NSE Trading Data — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Daily trading data (source of truth)
CREATE TABLE IF NOT EXISTS nse_daily (
    date               DATE PRIMARY KEY,
    day                TEXT NOT NULL,
    fy_quarter         TEXT NOT NULL,
    fy_month           TEXT NOT NULL,
    fy                 TEXT NOT NULL,
    -- F&O raw data
    if_turnover        NUMERIC DEFAULT 0,
    sf_turnover        NUMERIC DEFAULT 0,
    io_notional        NUMERIC DEFAULT 0,
    io_premium         NUMERIC DEFAULT 0,
    so_notional        NUMERIC DEFAULT 0,
    so_premium         NUMERIC DEFAULT 0,
    io_pcr             NUMERIC DEFAULT 0,
    total_contracts    BIGINT DEFAULT 0,
    total_turnover     NUMERIC DEFAULT 0,
    -- Computed revenue (Cr)
    if_rev             NUMERIC DEFAULT 0,
    sf_rev             NUMERIC DEFAULT 0,
    fut_rev            NUMERIC DEFAULT 0,
    io_rev             NUMERIC DEFAULT 0,
    so_rev             NUMERIC DEFAULT 0,
    opt_rev            NUMERIC DEFAULT 0,
    fo_rev             NUMERIC DEFAULT 0,
    -- Cash
    cash_traded_value  NUMERIC DEFAULT 0,
    cash_rev           NUMERIC DEFAULT 0,
    -- Totals
    total_rev          NUMERIC DEFAULT 0,
    -- Ratios
    pn_ratio           NUMERIC DEFAULT 0,
    vix                NUMERIC DEFAULT 0,
    -- Metadata
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

-- 2. Quarterly P&L (actual historical + predicted)
CREATE TABLE IF NOT EXISTS nse_pnl (
    quarter              TEXT PRIMARY KEY,
    trading_days         INT,
    is_predicted         BOOLEAN DEFAULT false,
    transaction_rev      NUMERIC,
    listing_income       NUMERIC,
    data_centre          NUMERIC,
    data_feed            NUMERIC,
    index_licensing      NUMERIC,
    clearing_settlement  NUMERIC,
    operating_investment NUMERIC,
    other_operating      NUMERIC,
    investment_income    NUMERIC,
    other_non_operating  NUMERIC,
    total_revenue        NUMERIC,
    employee_cost        NUMERIC,
    regulatory_fees      NUMERIC,
    depreciation         NUMERIC,
    technology_expense   NUMERIC,
    sebi_settlement      NUMERIC DEFAULT 0,
    csr_expense          NUMERIC DEFAULT 0,
    other_expense        NUMERIC,
    sgf_contribution     NUMERIC DEFAULT 0,
    total_expense        NUMERIC,
    ebitda               NUMERIC,
    ebitda_margin        NUMERIC,
    share_profit_associates NUMERIC DEFAULT 0,
    profit_sale_investment  NUMERIC DEFAULT 0,
    discontinued_operations NUMERIC DEFAULT 0,
    pbt                  NUMERIC,
    income_tax           NUMERIC,
    tax_rate             NUMERIC,
    pat                  NUMERIC,
    pat_margin           NUMERIC,
    eps                  NUMERIC
);

-- 3. Full-year P&L
CREATE TABLE IF NOT EXISTS nse_pnl_fy (
    fy              TEXT PRIMARY KEY,
    total_revenue   NUMERIC,
    total_expense   NUMERIC,
    ebitda          NUMERIC,
    ebitda_margin   NUMERIC,
    pbt             NUMERIC,
    pat             NUMERIC,
    pat_margin      NUMERIC,
    eps             NUMERIC
);

-- 4. Cost ratios by quarter
CREATE TABLE IF NOT EXISTS nse_cost_ratios (
    quarter           TEXT PRIMARY KEY,
    employee_pct      NUMERIC,
    regulatory_pct    NUMERIC,
    depreciation_pct  NUMERIC,
    technology_pct    NUMERIC,
    other_income_ratio NUMERIC
);

-- 5. Pre-computed aggregates (JSONB blobs for fast dashboard reads)
CREATE TABLE IF NOT EXISTS nse_aggregates (
    key         TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 6. Pipeline run log
CREATE TABLE IF NOT EXISTS nse_pipeline_runs (
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
CREATE INDEX IF NOT EXISTS idx_nse_daily_fy_quarter ON nse_daily(fy_quarter);
CREATE INDEX IF NOT EXISTS idx_nse_daily_fy_month ON nse_daily(fy_month);
CREATE INDEX IF NOT EXISTS idx_nse_daily_fy ON nse_daily(fy);

-- ============================================================
-- Row Level Security (optional — enable if exposing publicly)
-- ============================================================
-- ALTER TABLE nse_daily ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Public read access" ON nse_daily FOR SELECT USING (true);

-- ============================================================
-- Trigger: auto-update updated_at on nse_daily
-- ============================================================
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_nse_daily_modtime
    BEFORE UPDATE ON nse_daily
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
