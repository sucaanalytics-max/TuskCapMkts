"""
MCX Pipeline — Daily Updater
Reads MCX daily revenue from Supabase, recomputes all aggregates,
writes mcx_dashboard_data.json + mcx_enriched_data.json for the dashboard.

Environment variables:
  MCX_SUPABASE_URL   — Supabase project URL  (defaults to MCX project)
  MCX_SUPABASE_KEY   — anon or service key   (defaults to MCX anon key)
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path
from collections import OrderedDict

# Load .env for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Config ──────────────────────────────────────────────────────────────────
MCX_SUPABASE_URL = os.environ.get(
    "MCX_SUPABASE_URL",
    "https://avqwpebveqetwwzkmtux.supabase.co",
)
MCX_SUPABASE_KEY = os.environ.get(
    "MCX_SUPABASE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cXdwZWJ2ZXFldHd3emttdHV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MDkwMzMsImV4cCI6MjA4Njk4NTAzM30.U_Ug61Fp1NSCesXBkYU7GJGTbuATFtXsz6GTi5948Rw",
)

SCRIPT_DIR  = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR    = PROJECT_ROOT / "data"
DASHBOARD_DIR = PROJECT_ROOT / "dashboard" / "data"

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
        "Saturday", "Sunday"]


# ═══════════════════════════════════════════════════════════════
# SECTION 1: SUPABASE FETCH
# ═══════════════════════════════════════════════════════════════

def _sb_get(path, page_size=1000, max_rows=10000):
    """Paginated GET from Supabase REST API (no SDK dependency)."""
    all_rows = []
    offset = 0
    sep = "&" if "?" in path else "?"
    while True:
        url = f"{MCX_SUPABASE_URL}/rest/v1/{path}{sep}limit={page_size}&offset={offset}"
        req = urllib.request.Request(url, headers={
            "apikey": MCX_SUPABASE_KEY,
            "Authorization": f"Bearer {MCX_SUPABASE_KEY}",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            page = json.loads(r.read().decode())
        all_rows.extend(page)
        if len(page) < page_size or len(all_rows) >= max_rows:
            break
        offset += page_size
    return all_rows[:max_rows]


def fetch_mcx_daily():
    """Fetch all rows from mcx_daily_revenue, ordered by date."""
    rows = _sb_get(
        "mcx_daily_revenue"
        "?select=trading_date,fut_rev_cr,opt_rev_cr,total_rev_cr"
        "&order=trading_date.asc"
    )
    return rows


# ═══════════════════════════════════════════════════════════════
# SECTION 2: TRANSFORM
# ═══════════════════════════════════════════════════════════════

def _fy_label(dt):
    """Return 'FY YYYY' label. Indian FY: Apr-Mar."""
    if dt.month >= 4:
        return f"FY {dt.year + 1}"
    return f"FY {dt.year}"


def _fy_quarter(dt):
    """Return 'Q1 FY 2027' style label."""
    if dt.month >= 4 and dt.month <= 6:
        q, fy_year = "Q1", dt.year + 1
    elif dt.month >= 7 and dt.month <= 9:
        q, fy_year = "Q2", dt.year + 1
    elif dt.month >= 10 and dt.month <= 12:
        q, fy_year = "Q3", dt.year + 1
    else:
        q, fy_year = "Q4", dt.year
    return f"{q} FY {fy_year}"


def _fy_month(dt):
    """Return 'FY 2027 April' style label."""
    fy = _fy_label(dt)
    return f"{fy} {dt.strftime('%B')}"


def transform_rows(raw_rows):
    """Convert Supabase rows to the same daily record format as NSE/BSE.
    MCX has Futures and Options only — cash_rev is always 0.
    """
    records = []
    for r in raw_rows:
        try:
            dt = datetime.strptime(r["trading_date"], "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        fut_rev   = float(r.get("fut_rev_cr")   or 0)
        opt_rev   = float(r.get("opt_rev_cr")   or 0)
        total_rev = float(r.get("total_rev_cr") or 0)
        if total_rev <= 0 and (fut_rev + opt_rev) <= 0:
            continue
        if total_rev <= 0:
            total_rev = fut_rev + opt_rev

        records.append({
            "date":        dt.strftime("%Y-%m-%d"),
            "day":         DAYS[dt.weekday()],
            "fy":          _fy_label(dt),
            "fy_quarter":  _fy_quarter(dt),
            "fy_month":    _fy_month(dt),
            "fut_rev":     round(fut_rev,   4),
            "opt_rev":     round(opt_rev,   4),
            "cash_rev":    0.0,
            "total_rev":   round(total_rev, 4),
        })
    return records


# ═══════════════════════════════════════════════════════════════
# SECTION 3: AGGREGATIONS  (shared with BSE pipeline structure)
# ═══════════════════════════════════════════════════════════════

def recompute_quarterly(daily):
    quarters = OrderedDict()
    for d in daily:
        q = d["fy_quarter"]
        if q not in quarters:
            quarters[q] = {"quarter": q, "opt_rev": 0.0, "fut_rev": 0.0,
                           "cash_rev": 0.0, "total_rev": 0.0, "days": 0}
        for k in ["opt_rev", "fut_rev", "cash_rev", "total_rev"]:
            quarters[q][k] += float(d.get(k, 0) or 0)
        quarters[q]["days"] += 1
    return [{k: round(v, 4) if isinstance(v, float) else v
             for k, v in q.items()} for q in quarters.values()]


def recompute_monthly(daily):
    months = OrderedDict()
    for d in daily:
        m = d["fy_month"]
        if m not in months:
            months[m] = {"month": m, "opt_rev": 0.0, "fut_rev": 0.0,
                         "cash_rev": 0.0, "total_rev": 0.0, "days": 0}
        for k in ["opt_rev", "fut_rev", "cash_rev", "total_rev"]:
            months[m][k] += float(d.get(k, 0) or 0)
        months[m]["days"] += 1
    return [{k: round(v, 4) if isinstance(v, float) else v
             for k, v in m.items()} for m in months.values()]


def compute_summary(daily, quarterly):
    last = daily[-1] if daily else {}
    cq   = quarterly[-1] if quarterly else {}
    return {
        "current_quarter": cq.get("quarter", ""),
        "last_date":       last.get("date", ""),
        "total_trading_days": len(daily),
    }


# ═══════════════════════════════════════════════════════════════
# SECTION 4: ENRICHED DATA
# ═══════════════════════════════════════════════════════════════

def seg_summary(daily_data, rev_key):
    q = recompute_quarterly(daily_data)
    cq  = q[-1]  if q            else None
    pq  = q[-2]  if len(q) > 1  else None
    yoy_q = None
    if cq:
        parts = cq["quarter"].split()
        target_label = f"{parts[0]} FY {int(parts[2]) - 1}"
        yoy_q = next((x for x in q if x["quarter"] == target_label), None)

    cq_avg  = float(cq[rev_key])  / max(cq["days"], 1)  if cq  else 0
    pq_avg  = float(pq[rev_key])  / max(pq["days"], 1)  if pq  else 0
    yoy_avg = float(yoy_q[rev_key]) / max(yoy_q["days"], 1) if yoy_q else 0

    quarterly_data = {
        "current":  {"label": cq["quarter"] if cq else "",
                     "value": round(cq_avg, 4),
                     "qoq": round((cq_avg - pq_avg) / pq_avg, 4) if pq_avg else 0,
                     "yoy": round((cq_avg - yoy_avg) / yoy_avg, 4) if yoy_avg else 0},
        "previous": {"label": pq["quarter"] if pq else "",
                     "value": round(pq_avg, 4)},
        "prev2":    {"label": yoy_q["quarter"] if yoy_q else "",
                     "value": round(yoy_avg, 4)},
    }

    m = recompute_monthly(daily_data)
    cm  = m[-1] if m            else None
    pm  = m[-2] if len(m) > 1  else None
    last_6m = m[-6:] if len(m) >= 6 else m
    cm_avg  = float(cm[rev_key]) / max(cm["days"], 1)  if cm  else 0
    pm_avg  = float(pm[rev_key]) / max(pm["days"], 1)  if pm  else 0
    avg_6m  = (sum(float(x[rev_key]) / max(x["days"], 1) for x in last_6m)
               / max(len(last_6m), 1))

    monthly_data = {
        "current":  {"label": cm["month"] if cm else "",
                     "value": round(cm_avg, 4),
                     "mom":  round((cm_avg - pm_avg) / pm_avg, 4) if pm_avg else 0,
                     "mo6m": round((cm_avg - avg_6m) / avg_6m, 4) if avg_6m else 0},
        "previous": {"label": pm["month"] if pm else "",
                     "value": round(pm_avg, 4)},
        "avg_6m":   {"label": "Avg Of Last 6 Months",
                     "value": round(avg_6m, 4)},
    }

    last5 = daily_data[-5:]  if len(daily_data) >= 5  else daily_data
    prev5 = daily_data[-10:-5] if len(daily_data) >= 10 else []
    last45 = daily_data[-45:] if len(daily_data) >= 45 else daily_data
    l5_avg  = sum(float(d[rev_key]) for d in last5)  / max(len(last5),  1)
    p5_avg  = sum(float(d[rev_key]) for d in prev5)  / max(len(prev5),  1) if prev5 else 0
    l45_avg = sum(float(d[rev_key]) for d in last45) / max(len(last45), 1)

    weekly_data = {
        "last5":  {"label": "Last 5 Trading Days", "value": round(l5_avg, 4),
                   "wow":   round((l5_avg - p5_avg)  / p5_avg,  4) if p5_avg  else 0,
                   "wo10w": round((l5_avg - l45_avg) / l45_avg, 4) if l45_avg else 0},
        "prev5":  {"label": "Previous 5 Trading Days", "value": round(p5_avg, 4)},
        "last45": {"label": "Last 45 Trading Days",    "value": round(l45_avg, 4)},
    }

    days_list = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    dow = {}
    for day_name in days_list:
        recs = [d for d in daily_data if d["day"] == day_name]
        latest = float(recs[-1][rev_key]) if recs else 0
        last3  = recs[-3:]  if len(recs) >= 3  else recs
        last10 = recs[-10:] if len(recs) >= 10 else recs
        avg3   = sum(float(d[rev_key]) for d in last3)  / max(len(last3),  1)
        avg10  = sum(float(d[rev_key]) for d in last10) / max(len(last10), 1)
        dow[day_name] = {
            "latest": round(latest, 4),
            "do3d":   round((latest - avg3)  / avg3,  4) if avg3  else 0,
            "do10d":  round((latest - avg10) / avg10, 4) if avg10 else 0,
            "avg_3d": round(avg3,  4),
            "avg_10d": round(avg10, 4),
        }

    prev_week = {}
    pw_data = daily_data[-10:-5] if len(daily_data) >= 10 else []
    for d in pw_data:
        prev_week[d["day"]] = round(float(d[rev_key]), 4)

    # FY-level YoY
    fy_groups = OrderedDict()
    for d in daily_data:
        f = d["fy"]
        if f not in fy_groups:
            fy_groups[f] = {"sum": 0.0, "count": 0}
        fy_groups[f]["sum"]   += float(d.get(rev_key, 0) or 0)
        fy_groups[f]["count"] += 1
    fy_list = list(fy_groups.values())
    curr_fy_avg = fy_list[-1]["sum"] / max(fy_list[-1]["count"], 1) if fy_list else 0
    prev_fy_avg = fy_list[-2]["sum"] / max(fy_list[-2]["count"], 1) if len(fy_list) > 1 else 0
    fy_yoy      = (curr_fy_avg - prev_fy_avg) / prev_fy_avg if prev_fy_avg else 0

    return {
        "quarterly":     quarterly_data,
        "monthly":       monthly_data,
        "weekly":        weekly_data,
        "day_of_week":   dow,
        "previous_week": prev_week,
        "fy": {
            "current":  round(curr_fy_avg, 4),
            "previous": round(prev_fy_avg, 4),
            "yoy":      round(fy_yoy,      4),
        },
    }


def compute_enriched(daily, quarterly):
    enriched = {
        "summary_total": seg_summary(daily, "total_rev"),
        "seg_options":   seg_summary(daily, "opt_rev"),
        "seg_futures":   seg_summary(daily, "fut_rev"),
        "seg_cash":      seg_summary(daily, "cash_rev"),  # always zero for MCX
    }

    cq = quarterly[-1] if quarterly else None
    if cq:
        days_so_far    = cq["days"]
        expected_days  = 62
        daily_avg      = float(cq["total_rev"]) / max(days_so_far, 1)
        other_income_ratio = 0.0  # MCX: minimal non-F&O income at this scale
        txn_rev_extrap = daily_avg * expected_days
        total_rev_pred = txn_rev_extrap * (1 + other_income_ratio)
        enriched["pnl_predictor"] = {
            "daily_avg_rev":                round(daily_avg,      4),
            "trading_days_so_far":          days_so_far,
            "expected_trading_days":        expected_days,
            "transaction_rev_extrapolated": round(txn_rev_extrap, 2),
            "other_income_ratio":           round(other_income_ratio, 4),
            "total_revenue_predicted":      round(total_rev_pred, 2),
        }
    else:
        enriched["pnl_predictor"] = {}

    return enriched


# ═══════════════════════════════════════════════════════════════
# SECTION 5: WRITE JSON FILES
# ═══════════════════════════════════════════════════════════════

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"  Wrote {path} ({path.stat().st_size // 1024} KB)")


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("MCX Pipeline")
    print("=" * 60)

    print("Fetching MCX daily revenue from Supabase…")
    try:
        raw = fetch_mcx_daily()
    except Exception as e:
        print(f"ERROR fetching MCX data: {e}")
        sys.exit(1)
    print(f"  Fetched {len(raw)} raw rows")

    daily = transform_rows(raw)
    if not daily:
        print("ERROR: No valid MCX daily records after transform")
        sys.exit(1)

    quarterly = recompute_quarterly(daily)
    monthly   = recompute_monthly(daily)
    summary   = compute_summary(daily, quarterly)
    enriched  = compute_enriched(daily, quarterly)

    print(f"  Latest date: {summary['last_date']}")
    print(f"  Total daily records: {len(daily)}")
    print(f"  Current quarter: {summary['current_quarter']}")

    # dashboard_data.json
    dashboard_data = {
        "daily":     daily,
        "daily_all": daily,
        "monthly":   monthly,
        "quarterly": quarterly,
        "summary":   summary,
    }

    for out_dir in [DATA_DIR, DASHBOARD_DIR]:
        write_json(out_dir / "mcx_dashboard_data.json", dashboard_data)
        write_json(out_dir / "mcx_enriched_data.json",  enriched)

    print("=" * 60)
    print("MCX pipeline complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
