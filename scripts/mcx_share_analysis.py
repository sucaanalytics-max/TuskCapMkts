"""
MCX Ltd Share Price Analysis

Templated from bse_share_analysis.py with these differences:
- Ticker: MCX.NS
- No revenue seed CSV (mcx_daily_revenue Supabase has full history; mcx_pipeline
  already aggregates it into mcx_dashboard_data.json daily_all)
- Share prices come from mcx_share_price Supabase table (populated by
  scripts/mcx_price_refresh.py), with yfinance fallback for any stale tail

Outputs: dashboard/data/mcx_share_analysis.json

Run:  python scripts/mcx_share_analysis.py
      (also invoked daily by GitHub Actions after mcx_pipeline.py)
"""

import json
import os
import urllib.request
import urllib.error
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")

SCRIPT_DIR   = Path(__file__).parent
REPO_ROOT    = SCRIPT_DIR.parent
REVENUE_FILE = REPO_ROOT / "dashboard" / "data" / "mcx_dashboard_data.json"
OUTPUT_FILE  = REPO_ROOT / "dashboard" / "data" / "mcx_share_analysis.json"

REGRESSION_START = "2024-11-01"
MA_WINDOWS       = [20, 30, 45, 50, 60, 90]
PREFERRED_MA     = 45
FIXED_MA         = 45

MCX_SUPABASE_URL = os.environ.get(
    "MCX_SUPABASE_URL",
    "https://avqwpebveqetwwzkmtux.supabase.co",
)
MCX_SUPABASE_KEY = os.environ.get("MCX_SUPABASE_KEY", "")


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_pipeline(path):
    """Returns {date_str: total_rev} from mcx_dashboard_data.json."""
    with open(path) as f:
        raw = json.load(f)
    daily = raw.get("daily_all") or raw.get("daily", [])
    return {
        r["date"]: r["total_rev"]
        for r in daily
        if r.get("total_rev") is not None
    }


def load_supabase_prices(start_date_str):
    """Returns {date_str: close_price} from mcx_share_price."""
    if not MCX_SUPABASE_KEY:
        return {}
    url = (
        f"{MCX_SUPABASE_URL}/rest/v1/mcx_share_price"
        f"?select=trading_date,close&trading_date=gte.{start_date_str}"
        f"&order=trading_date.asc&limit=2000"
    )
    try:
        req = urllib.request.Request(
            url,
            headers={
                "apikey": MCX_SUPABASE_KEY,
                "Authorization": f"Bearer {MCX_SUPABASE_KEY}",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError):
        return {}
    return {
        r["trading_date"]: round(float(r["close"]), 2)
        for r in rows
        if r.get("close") is not None
    }


def fetch_yfinance_prices(start_date_str):
    """Returns {date_str: close_price} from yfinance MCX.NS."""
    import yfinance as yf
    hist = yf.Ticker("MCX.NS").history(start=start_date_str)
    return {
        str(d)[:10]: round(float(c), 2)
        for d, c in zip(hist.index, hist["Close"])
    }


# ---------------------------------------------------------------------------
# Dataset construction
# ---------------------------------------------------------------------------

def build_dataset(pipeline, sb_prices):
    """
    Merge revenue (from pipeline JSON) with prices (Supabase + yfinance tail).

    Price priority: Supabase > yfinance (yfinance fills dates beyond Supabase tail).
    """
    all_dates = sorted(set(pipeline) | set(sb_prices))

    # Find last date Supabase has a price for; pull yfinance for anything after.
    sb_dates = sorted(sb_prices)
    last_sb_date = sb_dates[-1] if sb_dates else None

    yf_prices = {}
    if last_sb_date:
        next_day = (
            datetime.strptime(last_sb_date, "%Y-%m-%d") + timedelta(days=1)
        ).strftime("%Y-%m-%d")
    else:
        next_day = REGRESSION_START
    try:
        yf_prices = fetch_yfinance_prices(next_day)
        if yf_prices:
            print(
                f"yfinance: {len(yf_prices)} prices "
                f"({min(yf_prices)} → {max(yf_prices)})"
            )
    except Exception as e:
        print(f"yfinance error: {e}")

    rows = []
    for d in all_dates:
        rev = pipeline.get(d)
        if rev is None:
            continue
        price = sb_prices.get(d) or yf_prices.get(d)
        if price is None:
            continue
        rows.append({"date": d, "revenue_cr": rev, "price": price})

    return sorted(rows, key=lambda r: r["date"])


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

def rolling_ma(values, window):
    result = []
    for i in range(len(values)):
        if i < window - 1:
            result.append(None)
        else:
            result.append(float(np.mean(values[i - window + 1 : i + 1])))
    return result


def run_ols(X, Y):
    slope, intercept = np.polyfit(X, Y, 1)
    pred = slope * X + intercept
    r2   = 1 - np.var(Y - pred) / np.var(Y)
    r    = np.corrcoef(X, Y)[0, 1]
    return slope, intercept, r2, r


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    print(f"[{now_utc}] MCX share analysis starting…")

    pipeline  = load_pipeline(REVENUE_FILE)
    sb_prices = load_supabase_prices(REGRESSION_START)
    print(f"Pipeline:  {len(pipeline)} rows  ({min(pipeline)} → {max(pipeline)})")
    print(f"Supabase:  {len(sb_prices)} price rows")

    all_rows = build_dataset(pipeline, sb_prices)
    if not all_rows:
        print("No overlapping revenue+price rows. Run mcx_price_refresh.py with --backfill first.")
        return

    print(
        f"Combined: {len(all_rows)} rows  "
        f"({all_rows[0]['date']} → {all_rows[-1]['date']})"
    )

    revenues = [r["revenue_cr"] for r in all_rows]

    print(f"\nMA window comparison (regression from {REGRESSION_START}):")
    window_results = {}
    for window in MA_WINDOWS:
        mas = rolling_ma(revenues, window)
        reg = [
            {"date": r["date"], "rev_ma": mas[i], "price": r["price"], "revenue_cr": r["revenue_cr"]}
            for i, r in enumerate(all_rows)
            if r["date"] >= REGRESSION_START and mas[i] is not None
        ]
        if len(reg) < 10:
            continue
        X = np.array([r["rev_ma"] for r in reg])
        Y = np.array([r["price"]  for r in reg])
        slope, intercept, r2, pearson_r = run_ols(X, Y)
        window_results[window] = {
            "slope": slope, "intercept": intercept,
            "r2": r2, "pearson_r": pearson_r, "n": len(reg),
        }
        marker = " ← preferred" if window == PREFERRED_MA else ""
        print(f"  MA{window:2d}: R²={r2:.4f}  r={pearson_r:.4f}  n={len(reg)}{marker}")

    if FIXED_MA not in window_results:
        print(f"Not enough data for MA{FIXED_MA} — pick another window or backfill more history.")
        return

    best_window = FIXED_MA
    best = window_results[best_window]
    print(f"\nUsing MA{best_window} (R²={best['r2']:.4f})")

    mas = rolling_ma(revenues, best_window)
    series = []
    for i, row in enumerate(all_rows):
        if mas[i] is None:
            continue
        pred = best["slope"] * mas[i] + best["intercept"]
        series.append({
            "date":       row["date"],
            "revenue_cr": round(row["revenue_cr"], 4),
            "rev_ma":     round(mas[i], 4),
            "price":      row["price"],
            "price_pred": round(pred, 2),
        })

    reg_series = [r for r in series if r["date"] >= REGRESSION_START]
    latest     = reg_series[-1] if reg_series else series[-1]
    error_pct  = round(
        abs(latest["price_pred"] - latest["price"]) / latest["price"] * 100, 1
    )
    fit_label  = "strong" if best["r2"] > 0.7 else "moderate" if best["r2"] > 0.4 else "weak"

    output = {
        "updated_at":       now_utc,
        "ticker":           "MCX.NS",
        "ma_window":        best_window,
        "regression_start": REGRESSION_START,
        "n_days":           len(reg_series),
        "ma_window_comparison": {
            str(w): {
                "r_squared":  round(v["r2"],       4),
                "pearson_r":  round(v["pearson_r"], 4),
                "n":          v["n"],
            }
            for w, v in window_results.items()
        },
        "regression": {
            "slope":      round(best["slope"],      4),
            "intercept":  round(best["intercept"],  2),
            "r_squared":  round(best["r2"],         4),
            "pearson_r":  round(best["pearson_r"],  4),
            "equation":   (
                f"Price = {best['slope']:.2f} × "
                f"Rev_MA{best_window} + {best['intercept']:.2f}"
            ),
            "fit": fit_label,
        },
        "latest": {
            "date":         latest["date"],
            "revenue_cr":   latest["revenue_cr"],
            "rev_ma":       latest["rev_ma"],
            "price_actual": latest["price"],
            "price_pred":   latest["price_pred"],
            "error_pct":    error_pct,
        },
        "series": series,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(output, indent=2))
    print(
        f"\nWrote {OUTPUT_FILE.name} "
        f"({len(series)} total rows, {len(reg_series)} in regression window)"
    )
    print(
        f"Latest ({latest['date']}): "
        f"actual ₹{latest['price']}  "
        f"pred ₹{latest['price_pred']}  "
        f"error {error_pct}%"
    )


if __name__ == "__main__":
    main()
