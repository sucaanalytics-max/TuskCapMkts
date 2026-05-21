"""
NSE Cloud Pipeline — GitHub Actions Daily Updater
Fetches NSE data via curl_cffi, upserts to Supabase, recomputes all aggregates,
writes dashboard_data.json + enriched_data.json for Vercel static build.

Environment variables (set as GitHub Secrets):
  SUPABASE_URL        — e.g. https://xxxx.supabase.co
  SUPABASE_KEY        — service_role key (not anon)
"""

import json
import os
import sys
import math
from datetime import datetime, timedelta
from pathlib import Path
from collections import OrderedDict

# Load .env for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Config ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
DASHBOARD_DIR = PROJECT_ROOT / "dashboard"

# ── Take Rates ──
TR_FUT  = 3.46e-05
TR_OPT  = 7.006e-04
TR_CASH = 5.94e-05


# ═══════════════════════════════════════════════════════════════
# SECTION 0: VIX DATA FETCHER (Yahoo Finance ^INDIAVIX)
# ═══════════════════════════════════════════════════════════════

def fetch_indiavix_map(start_date, end_date):
    """Fetch India VIX closing prices from Yahoo Finance.
    Returns {date_str: vix_value} for the given date range, or {} on failure.
    """
    try:
        import yfinance as yf
        end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=2)
        ticker = yf.Ticker("^INDIAVIX")
        hist = ticker.history(start=start_date, end=end_dt.strftime("%Y-%m-%d"))
        if hist.empty:
            print("WARNING: No VIX data returned from Yahoo Finance")
            return {}
        result = {str(idx.date()): round(float(row["Close"]), 4)
                  for idx, row in hist.iterrows()}
        print(f"Fetched {len(result)} India VIX data points ({start_date} to {end_date})")
        return result
    except ImportError:
        print("WARNING: yfinance not installed — VIX data unavailable. Run: pip install yfinance")
        return {}
    except Exception as e:
        print(f"WARNING: VIX fetch failed (non-fatal): {e}")
        return {}


# ═══════════════════════════════════════════════════════════════
# SECTION 1: NSE DATA FETCHER (curl_cffi with Chrome impersonation)
# ═══════════════════════════════════════════════════════════════

def fetch_nse_data():
    """Fetch current month's F&O and Cash data from NSE APIs."""
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        print("ERROR: curl_cffi not installed. Run: pip install curl_cffi")
        sys.exit(1)

    session = cffi_requests.Session()

    # Warm up — get session cookies from NSE homepage
    print("Warming up NSE session...")
    resp = session.get("https://www.nseindia.com/", impersonate="chrome")
    if resp.status_code != 200:
        print(f"WARNING: Homepage returned {resp.status_code}, trying API anyway...")

    now = datetime.now()
    month_abbr = now.strftime("%b")      # "Mar"
    year_full  = str(now.year)           # "2026"
    year_short = now.strftime("%y")      # "26"

    # F&O API
    fo_url = f"https://www.nseindia.com/api/historicalOR/fo/tbg/daily?month={month_abbr}&year={year_full}"
    print(f"Fetching F&O: {fo_url}")
    fo_resp = session.get(fo_url, impersonate="chrome")

    if fo_resp.status_code != 200:
        print(f"ERROR: F&O API returned {fo_resp.status_code}")
        # Try previous month if current month has no data yet
        prev = now.replace(day=1) - timedelta(days=1)
        month_abbr = prev.strftime("%b")
        year_full  = str(prev.year)
        year_short = prev.strftime("%y")
        fo_url = f"https://www.nseindia.com/api/historicalOR/fo/tbg/daily?month={month_abbr}&year={year_full}"
        print(f"Retrying with previous month: {fo_url}")
        fo_resp = session.get(fo_url, impersonate="chrome")

    # Cash API
    cm_url = f"https://www.nseindia.com/api/historicalOR/cm/tbg/daily?month={month_abbr}&year={year_short}"
    print(f"Fetching Cash: {cm_url}")
    cm_resp = session.get(cm_url, impersonate="chrome")

    fo_json = fo_resp.json() if fo_resp.status_code == 200 else {"data": []}
    cm_json = cm_resp.json() if cm_resp.status_code == 200 else {"data": []}

    print(f"F&O records: {len(fo_json.get('data', []))}, Cash records: {len(cm_json.get('data', []))}")
    return fo_json, cm_json


# ═══════════════════════════════════════════════════════════════
# SECTION 2: DATA PARSING (same logic as nse_updater.py)
# ═══════════════════════════════════════════════════════════════

def date_to_fy_quarter(dt):
    m, y = dt.month, dt.year
    if m >= 4:
        fy_year = y + 1
        q = 1 if m <= 6 else (2 if m <= 9 else 3)
    else:
        fy_year = y
        q = 4
    return f"Q{q} FY {fy_year}"

def date_to_fy_month(dt):
    fy_year = dt.year + 1 if dt.month >= 4 else dt.year
    return f"FY {fy_year} {dt.strftime('%B')}"

def date_to_fy(dt):
    fy_year = dt.year + 1 if dt.month >= 4 else dt.year
    return f"FY {fy_year}"

def parse_fo_record(rec):
    d = rec.get("data", rec)
    date_str = d.get("date", d.get("F_TIMESTAMP", ""))
    dt = datetime.strptime(date_str, "%d-%b-%Y")

    if_turnover   = float(d.get("Index_Futures_VAL", 0))
    sf_turnover   = float(d.get("Stock_Futures_VAL", 0))
    io_notional   = float(d.get("Index_Options_VAL", 0))
    io_premium    = float(d.get("Index_Options_PREM_VAL", 0))
    so_notional   = float(d.get("Stock_Options_VAL", 0))
    so_premium    = float(d.get("Stock_Options_PREM_VAL", 0))
    io_pcr        = float(d.get("Index_Options_PUT_CALL_RATIO", 0))
    total_contracts = int(d.get("F&O_Total_QTY", 0))
    total_turnover  = float(d.get("F&O_Total_VAL", 0))

    if_rev  = if_turnover * TR_FUT
    sf_rev  = sf_turnover * TR_FUT
    fut_rev = if_rev + sf_rev
    io_rev  = io_premium * TR_OPT
    so_rev  = so_premium * TR_OPT
    opt_rev = io_rev + so_rev
    fo_rev  = fut_rev + opt_rev

    total_premium  = io_premium + so_premium
    total_notional = io_notional + so_notional
    pn_ratio = total_premium / total_notional if total_notional > 0 else 0

    return {
        "date": dt.strftime("%Y-%m-%d"),
        "day": dt.strftime("%A"),
        "fy_quarter": date_to_fy_quarter(dt),
        "fy_month": date_to_fy_month(dt),
        "fy": date_to_fy(dt),
        "if_turnover": round(if_turnover, 2),
        "sf_turnover": round(sf_turnover, 2),
        "io_notional": round(io_notional, 2),
        "io_premium": round(io_premium, 2),
        "so_notional": round(so_notional, 2),
        "so_premium": round(so_premium, 2),
        "io_pcr": round(io_pcr, 2),
        "total_contracts": total_contracts,
        "total_turnover": round(total_turnover, 2),
        "if_rev": round(if_rev, 4),
        "sf_rev": round(sf_rev, 4),
        "fut_rev": round(fut_rev, 4),
        "io_rev": round(io_rev, 4),
        "so_rev": round(so_rev, 4),
        "opt_rev": round(opt_rev, 4),
        "fo_rev": round(fo_rev, 4),
        "pn_ratio": pn_ratio,
        "vix": 0,
        "_dt": dt,
    }

def parse_cm_record(rec):
    d = rec.get("data", rec)
    date_str = d.get("F_TIMESTAMP", "")
    dt = datetime.strptime(date_str, "%d-%b-%Y")
    cash_traded_value = float(d.get("CDT_TRADES_VALUES", 0))
    cash_rev = cash_traded_value * TR_CASH
    return {
        "date": dt.strftime("%Y-%m-%d"),
        "cash_traded_value": round(cash_traded_value, 2),
        "cash_rev": round(cash_rev, 4),
    }


# ═══════════════════════════════════════════════════════════════
# SECTION 3: SUPABASE OPERATIONS
# ═══════════════════════════════════════════════════════════════

def get_supabase_client():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def get_existing_dates(supabase):
    """Get all existing dates from nse_daily table."""
    result = supabase.table("nse_daily").select("date").execute()
    return {row["date"] for row in result.data}

def upsert_daily_records(supabase, records):
    """Upsert parsed daily records into Supabase."""
    if not records:
        return 0

    # Remove internal keys, prepare for upsert
    clean = []
    for r in records:
        row = {k: v for k, v in r.items() if k != "_dt"}
        clean.append(row)

    # Upsert in batches of 50
    inserted = 0
    for i in range(0, len(clean), 50):
        batch = clean[i:i+50]
        supabase.table("nse_daily").upsert(batch, on_conflict="date").execute()
        inserted += len(batch)

    return inserted

def fetch_all_daily(supabase):
    """Fetch all daily records from Supabase, ordered by date."""
    all_records = []
    offset = 0
    batch_size = 1000
    while True:
        result = (supabase.table("nse_daily")
                  .select("*")
                  .order("date")
                  .range(offset, offset + batch_size - 1)
                  .execute())
        if not result.data:
            break
        all_records.extend(result.data)
        if len(result.data) < batch_size:
            break
        offset += batch_size
    return all_records

def fetch_pnl(supabase):
    """Fetch P&L data."""
    result = supabase.table("nse_pnl").select("*").order("quarter").execute()
    return result.data

def fetch_pnl_fy(supabase):
    result = supabase.table("nse_pnl_fy").select("*").order("fy").execute()
    return result.data

def fetch_cost_ratios(supabase):
    result = supabase.table("nse_cost_ratios").select("*").execute()
    return {row["quarter"]: {k: v for k, v in row.items() if k != "quarter"} for row in result.data}

def save_aggregates(supabase, key, data):
    """Save a computed aggregate to nse_aggregates table."""
    supabase.table("nse_aggregates").upsert({
        "key": key,
        "data": data,
        "updated_at": datetime.utcnow().isoformat()
    }, on_conflict="key").execute()

def log_pipeline_run(supabase, new_days, latest_date, status="success", details=""):
    supabase.table("nse_pipeline_runs").insert({
        "new_days_added": new_days,
        "latest_date": latest_date,
        "status": status,
        "details": details,
        "source": "github_actions"
    }).execute()


# ═══════════════════════════════════════════════════════════════
# SECTION 4: AGGREGATE COMPUTATIONS (same as nse_updater.py)
# ═══════════════════════════════════════════════════════════════

def recompute_quarterly(daily):
    quarters = OrderedDict()
    for d in daily:
        q = d["fy_quarter"]
        if q not in quarters:
            quarters[q] = {"quarter": q, "opt_rev": 0, "fut_rev": 0, "cash_rev": 0,
                           "total_rev": 0, "days": 0, "io_rev": 0, "so_rev": 0,
                           "if_rev": 0, "sf_rev": 0}
        for k in ["opt_rev","fut_rev","cash_rev","total_rev","io_rev","so_rev","if_rev","sf_rev"]:
            quarters[q][k] += float(d.get(k, 0) or 0)
        quarters[q]["days"] += 1

    return [{k: round(v, 2) if isinstance(v, float) else v
             for k, v in q.items()} for q in quarters.values()]

def recompute_monthly(daily):
    months = OrderedDict()
    for d in daily:
        m = d["fy_month"]
        if m not in months:
            months[m] = {"month": m, "opt_rev": 0, "fut_rev": 0, "cash_rev": 0,
                         "total_rev": 0, "days": 0}
        for k in ["opt_rev","fut_rev","cash_rev","total_rev"]:
            months[m][k] += float(d.get(k, 0) or 0)
        months[m]["days"] += 1

    return [{k: round(v, 2) if isinstance(v, float) else v
             for k, v in m.items()} for m in months.values()]

def recompute_weekly(daily):
    weeks = OrderedDict()
    for d in daily:
        dt = datetime.strptime(d["date"], "%Y-%m-%d")
        week_start = dt - timedelta(days=dt.weekday())
        wk = week_start.strftime("%Y-%m-%d")
        if wk not in weeks:
            weeks[wk] = {"week": wk, "opt_rev": 0, "fut_rev": 0, "cash_rev": 0,
                         "total_rev": 0, "days": 0}
        for k in ["opt_rev","fut_rev","cash_rev","total_rev"]:
            weeks[wk][k] += float(d.get(k, 0) or 0)
        weeks[wk]["days"] += 1

    return [{k: round(v, 2) if isinstance(v, float) else v
             for k, v in w.items()} for w in weeks.values()]

def recompute_dow_avg(daily):
    recent = daily[-50:] if len(daily) > 50 else daily
    days = ["Monday","Tuesday","Wednesday","Thursday","Friday"]
    dow = {}
    for day_name in days:
        day_data = [d for d in recent if d["day"] == day_name]
        if day_data:
            n = len(day_data)
            dow[day_name] = {
                "avg_total": round(sum(float(d.get("total_rev",0) or 0) for d in day_data) / n, 4),
                "avg_options": round(sum(float(d.get("opt_rev",0) or 0) for d in day_data) / n, 4),
                "avg_futures": round(sum(float(d.get("fut_rev",0) or 0) for d in day_data) / n, 4),
                "avg_cash": round(sum(float(d.get("cash_rev",0) or 0) for d in day_data) / n, 4),
                "count": n,
            }
        else:
            dow[day_name] = {"avg_total": 0, "avg_options": 0, "avg_futures": 0, "avg_cash": 0, "count": 0}
    return dow

def compute_summary(daily, quarterly):
    last = daily[-1] if daily else {}
    cq = quarterly[-1] if quarterly else {}
    last5 = daily[-5:] if len(daily) >= 5 else daily
    prev5 = daily[-10:-5] if len(daily) >= 10 else []
    l5_total = sum(float(d.get("total_rev",0) or 0) for d in last5)
    p5_total = sum(float(d.get("total_rev",0) or 0) for d in prev5)
    wow = (l5_total - p5_total) / p5_total if p5_total else 0

    return {
        "current_quarter": cq.get("quarter", ""),
        "cq_total_rev": round(float(cq.get("total_rev", 0)), 2),
        "cq_options_rev": round(float(cq.get("opt_rev", 0)), 2),
        "cq_futures_rev": round(float(cq.get("fut_rev", 0)), 2),
        "cq_cash_rev": round(float(cq.get("cash_rev", 0)), 2),
        "cq_trading_days": cq.get("days", 0),
        "last5_total": round(l5_total, 2),
        "prev5_total": round(p5_total, 2),
        "wow_change": round(wow, 4),
        "last_date": last.get("date", ""),
    }


# ═══════════════════════════════════════════════════════════════
# SECTION 5: ENRICHED DATA (segment summaries, predictor)
# ═══════════════════════════════════════════════════════════════

def seg_summary(daily_data, rev_key):
    q = recompute_quarterly(daily_data)
    cq = q[-1] if q else None
    pq = q[-2] if len(q) > 1 else None
    yoy_q = None
    if cq:
        parts = cq["quarter"].split()
        target_label = f"{parts[0]} FY {int(parts[2]) - 1}"
        yoy_q = next((x for x in q if x["quarter"] == target_label), None)

    cq_avg = float(cq[rev_key]) / max(cq["days"], 1) if cq else 0
    pq_avg = float(pq[rev_key]) / max(pq["days"], 1) if pq else 0
    yoy_avg = float(yoy_q[rev_key]) / max(yoy_q["days"], 1) if yoy_q else 0

    quarterly_data = {
        "current":  {"label": cq["quarter"] if cq else "", "value": round(cq_avg, 4),
                     "qoq": round((cq_avg - pq_avg) / pq_avg, 4) if pq_avg else 0,
                     "yoy": round((cq_avg - yoy_avg) / yoy_avg, 4) if yoy_avg else 0},
        "previous": {"label": pq["quarter"] if pq else "", "value": round(pq_avg, 4)},
        "prev2":    {"label": yoy_q["quarter"] if yoy_q else "", "value": round(yoy_avg, 4)},
    }

    m = recompute_monthly(daily_data)
    cm = m[-1] if m else None
    pm = m[-2] if len(m) > 1 else None
    last_6m = m[-6:] if len(m) >= 6 else m
    cm_avg = float(cm[rev_key]) / max(cm["days"], 1) if cm else 0
    pm_avg = float(pm[rev_key]) / max(pm["days"], 1) if pm else 0
    avg_6m = sum(float(x[rev_key]) / max(x["days"], 1) for x in last_6m) / max(len(last_6m), 1)

    monthly_data = {
        "current":  {"label": cm["month"] if cm else "", "value": round(cm_avg, 4),
                     "mom": round((cm_avg - pm_avg) / pm_avg, 4) if pm_avg else 0,
                     "mo6m": round((cm_avg - avg_6m) / avg_6m, 4) if avg_6m else 0},
        "previous": {"label": pm["month"] if pm else "", "value": round(pm_avg, 4)},
        "avg_6m":   {"label": "Avg Of Last 6 Months", "value": round(avg_6m, 4)},
    }

    last5 = daily_data[-5:] if len(daily_data) >= 5 else daily_data
    prev5 = daily_data[-10:-5] if len(daily_data) >= 10 else []
    last45 = daily_data[-45:] if len(daily_data) >= 45 else daily_data
    l5_avg = sum(float(d[rev_key]) for d in last5) / max(len(last5), 1)
    p5_avg = sum(float(d[rev_key]) for d in prev5) / max(len(prev5), 1) if prev5 else 0
    l45_avg = sum(float(d[rev_key]) for d in last45) / max(len(last45), 1)

    weekly_data = {
        "last5":  {"label": "Last 5 Trading Days", "value": round(l5_avg, 4),
                   "wow": round((l5_avg - p5_avg) / p5_avg, 4) if p5_avg else 0,
                   "wo10w": round((l5_avg - l45_avg) / l45_avg, 4) if l45_avg else 0},
        "prev5":  {"label": "Previous 5 Trading Days", "value": round(p5_avg, 4)},
        "last45": {"label": "Last 45 Trading Days", "value": round(l45_avg, 4)},
    }

    days_list = ["Monday","Tuesday","Wednesday","Thursday","Friday"]
    dow = {}
    for day_name in days_list:
        recs = [d for d in daily_data if d["day"] == day_name]
        latest = float(recs[-1][rev_key]) if recs else 0
        last3 = recs[-3:] if len(recs) >= 3 else recs
        last10 = recs[-10:] if len(recs) >= 10 else recs
        avg3 = sum(float(d[rev_key]) for d in last3) / max(len(last3), 1)
        avg10 = sum(float(d[rev_key]) for d in last10) / max(len(last10), 1)
        dow[day_name] = {
            "latest": round(latest, 4),
            "do3d": round((latest - avg3) / avg3, 4) if avg3 else 0,
            "do10d": round((latest - avg10) / avg10, 4) if avg10 else 0,
            "avg_3d": round(avg3, 4), "avg_10d": round(avg10, 4),
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
            fy_groups[f] = {"sum": 0, "count": 0}
        fy_groups[f]["sum"] += float(d.get(rev_key, 0) or 0)
        fy_groups[f]["count"] += 1
    fy_list = list(fy_groups.values())
    curr_fy_avg = fy_list[-1]["sum"] / max(fy_list[-1]["count"], 1) if fy_list else 0
    prev_fy_avg = fy_list[-2]["sum"] / max(fy_list[-2]["count"], 1) if len(fy_list) > 1 else 0
    fy_yoy = (curr_fy_avg - prev_fy_avg) / prev_fy_avg if prev_fy_avg else 0

    return {
        "quarterly": quarterly_data,
        "monthly": monthly_data,
        "weekly": weekly_data,
        "day_of_week": dow,
        "previous_week": prev_week,
        "fy": {"current": round(curr_fy_avg, 4), "previous": round(prev_fy_avg, 4), "yoy": round(fy_yoy, 4)},
    }

def _next_quarter(quarter_name):
    """Return the quarter immediately following quarter_name.
    e.g. 'Q4 FY 2026' -> 'Q1 FY 2027', 'Q2 FY 2026' -> 'Q3 FY 2026'
    """
    parts = quarter_name.split()          # ["Q4", "FY", "2026"]
    q_num   = int(parts[0][1])
    fy_year = int(parts[2])
    if q_num == 4:
        return f"Q1 FY {fy_year + 1}"
    return f"Q{q_num + 1} FY {fy_year}"


def compute_predicted_quarters(pnl_predictor, pnl_history, quarterly):
    """Build the pnl_predicted_quarters dict using live predictor + historical cost ratios.

    Returns a dict with two entries:
      - current quarter (label "CURRENT" in the dashboard)
      - next quarter (YoY-growth projection)
    Both are derived from pnl_predictor values with cost ratios inferred from
    the most recent 2 actual (non-predicted) historical P&L quarters.
    """
    if not pnl_predictor or not pnl_history:
        return {}

    actual_pnl = [p for p in pnl_history if not p.get("is_predicted")]
    if not actual_pnl:
        return {}

    recent = actual_pnl[-2:] if len(actual_pnl) >= 2 else actual_pnl

    def avg_ratio(num_key, den_key):
        vals = [float(q[num_key]) / float(q[den_key])
                for q in recent
                if q.get(num_key) is not None and float(q.get(den_key, 0) or 0) > 0]
        return sum(vals) / len(vals) if vals else None

    exp_ratio     = avg_ratio("total_expense", "total_revenue") or 0.25
    pat_ratio     = avg_ratio("pat",           "total_revenue") or 0.567
    eps_pat_ratio = avg_ratio("eps",           "pat")           or 0.004

    def build_entry(txn_rev, total_rev):
        pat           = total_rev * pat_ratio
        total_expense = total_rev * exp_ratio
        ebitda        = total_rev - total_expense
        ebitda_margin = ebitda / total_rev if total_rev else 0
        eps           = pat * eps_pat_ratio
        return {
            "transaction_rev": round(txn_rev, 2),
            "total_revenue":   round(total_rev, 2),
            "total_expense":   round(total_expense, 2),
            "ebitda":          round(ebitda, 2),
            "ebitda_margin":   round(ebitda_margin, 4),
            "pat":             round(pat, 2),
            "pat_margin":      round(pat / total_rev, 4) if total_rev else 0,
            "eps":             round(eps, 2),
        }

    result = {}

    # Current quarter: from live trading data via pnl_predictor
    cq_name = date_to_fy_quarter(datetime.now())
    result[cq_name] = build_entry(
        pnl_predictor["transaction_rev_extrapolated"],
        pnl_predictor["total_revenue_predicted"],
    )

    # Next quarter: YoY-growth projection
    nq_name = _next_quarter(cq_name)
    if len(quarterly) >= 5:
        same_q_prev = f"{cq_name.split()[0]} FY {int(cq_name.split()[2]) - 1}"
        prev_q = next((q for q in quarterly if q["quarter"] == same_q_prev), None)
        curr_q = quarterly[-1]
        if prev_q and float(prev_q.get("total_rev", 0) or 0):
            yoy_growth = float(curr_q["total_rev"]) / float(prev_q["total_rev"]) - 1
        else:
            yoy_growth = 0.10
    else:
        yoy_growth = 0.10

    next_total_rev = pnl_predictor["total_revenue_predicted"] * (1 + yoy_growth)
    next_txn_rev   = next_total_rev / (1 + float(pnl_predictor.get("other_income_ratio", 0.47)))
    result[nq_name] = build_entry(next_txn_rev, next_total_rev)

    return result


def compute_enriched(daily, quarterly, pnl):
    enriched = {
        "summary_total": seg_summary(daily, "total_rev"),
        "seg_options":   seg_summary(daily, "opt_rev"),
        "seg_futures":   seg_summary(daily, "fut_rev"),
        "seg_cash":      seg_summary(daily, "cash_rev"),
    }

    cq = quarterly[-1] if quarterly else None
    if cq and pnl:
        actual_pnl = [p for p in pnl if not p.get("is_predicted")]
        last_pnl = actual_pnl[-1] if actual_pnl else None
        days_so_far = cq["days"]
        expected_days = 62
        daily_avg = float(cq["total_rev"]) / max(days_so_far, 1)
        other_income_ratio = 0.4714
        if last_pnl and float(last_pnl.get("transaction_rev", 0) or 0) > 0:
            other_income_ratio = (float(last_pnl.get("total_revenue", 0)) - float(last_pnl.get("transaction_rev", 0))) / float(last_pnl["transaction_rev"])
        txn_rev_extrap = daily_avg * expected_days
        total_rev_pred = txn_rev_extrap * (1 + other_income_ratio)
        enriched["pnl_predictor"] = {
            "daily_avg_rev": round(daily_avg, 4),
            "q4_fy2026_trading_days_so_far": days_so_far,
            "q4_fy2025_total_trading_days": expected_days,
            "transaction_rev_extrapolated": round(txn_rev_extrap, 2),
            "other_income_ratio": round(other_income_ratio, 4),
            "total_revenue_predicted": round(total_rev_pred, 2),
            "pat_predicted": round(total_rev_pred * 0.567, 2),
        }
    else:
        enriched["pnl_predictor"] = {}

    enriched["pnl_predicted_quarters"] = compute_predicted_quarters(
        enriched.get("pnl_predictor"), pnl, quarterly
    )
    return enriched


# ═══════════════════════════════════════════════════════════════
# SECTION 6: BUILD dashboard_data.json (for static Vercel deploy)
# ═══════════════════════════════════════════════════════════════

def build_dashboard_json(daily_all, quarterly, monthly, weekly, dow_avg, summary,
                         pnl, pnl_fy, cost_ratios, take_rates, vix_data):
    """Build the exact same structure as the current dashboard_data.json."""
    # daily = last 120 records (for charts), daily_all = everything
    daily_recent = daily_all[-120:] if len(daily_all) > 120 else daily_all

    return {
        "daily": daily_recent,
        "daily_all": daily_all,
        "monthly": monthly,
        "quarterly": quarterly,
        "weekly": weekly[-15:] if len(weekly) > 15 else weekly,
        "dow_avg": dow_avg,
        "pnl": pnl,
        "pnl_fy": pnl_fy,
        "cost_ratios": cost_ratios,
        "take_rates": take_rates,
        "vix": vix_data,
        "summary": summary,
    }


# ═══════════════════════════════════════════════════════════════
# SECTION 7: WRITE DASHBOARD DATA FILES
# (Unified dashboard uses fetch() from dashboard/data/*.json)
# ═══════════════════════════════════════════════════════════════

def write_dashboard_data(dashboard_data, enriched_data):
    """Write NSE data files to dashboard/data/ for Vercel serving."""
    dash_data_dir = DASHBOARD_DIR / "data"
    dash_data_dir.mkdir(parents=True, exist_ok=True)

    nse_dash_path = dash_data_dir / "nse_dashboard_data.json"
    nse_enrich_path = dash_data_dir / "nse_enriched_data.json"

    with open(nse_dash_path, "w") as f:
        json.dump(dashboard_data, f, separators=(',', ':'))
    with open(nse_enrich_path, "w") as f:
        json.dump(enriched_data, f, separators=(',', ':'))

    print(f"Wrote {nse_dash_path}")
    print(f"Wrote {nse_enrich_path}")
    return True


# ═══════════════════════════════════════════════════════════════
# SECTION 8: MAIN PIPELINE
# ═══════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("NSE Cloud Pipeline — Daily Update")
    print(f"Run time: {datetime.utcnow().isoformat()}Z")
    print("=" * 60)

    # Step 1: Fetch from NSE
    fo_json, cm_json = fetch_nse_data()

    fo_records = fo_json.get("data", [])
    cm_records = cm_json.get("data", [])

    if not fo_records:
        print("No F&O data returned from NSE. Exiting.")
        return

    # Step 2: Parse records
    cm_by_date = {}
    for rec in cm_records:
        parsed = parse_cm_record(rec)
        cm_by_date[parsed["date"]] = parsed

    new_parsed = []
    for rec in fo_records:
        parsed = parse_fo_record(rec)
        date_key = parsed["date"]
        cm = cm_by_date.get(date_key, {})
        parsed["cash_traded_value"] = cm.get("cash_traded_value", 0)
        parsed["cash_rev"] = cm.get("cash_rev", 0)
        parsed["total_rev"] = round(parsed["fo_rev"] + parsed["cash_rev"], 4)
        del parsed["_dt"]
        new_parsed.append(parsed)

    print(f"Parsed {len(new_parsed)} records from NSE")

    # Step 3: Supabase operations
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("WARNING: Supabase credentials not set. Writing local files only.")
        supabase = None
    else:
        supabase = get_supabase_client()
        existing_dates = get_existing_dates(supabase)
        to_insert = [r for r in new_parsed if r["date"] not in existing_dates]
        print(f"Existing dates in DB: {len(existing_dates)}, New records to insert: {len(to_insert)}")

        if to_insert:
            upsert_daily_records(supabase, to_insert)
            print(f"Upserted {len(to_insert)} new daily records to Supabase")
        else:
            print("No new records to insert into Supabase")

    # Step 4: Fetch full dataset and recompute
    if supabase:
        all_daily = fetch_all_daily(supabase)
        pnl = fetch_pnl(supabase)
        pnl_fy = fetch_pnl_fy(supabase)
        cost_ratios = fetch_cost_ratios(supabase)
    else:
        # Fallback: read from existing data file
        existing_path = DATA_DIR / "dashboard_data.json"
        if existing_path.exists():
            with open(existing_path) as f:
                existing = json.load(f)
            all_daily = existing.get("daily_all", [])
            pnl = existing.get("pnl", [])
            pnl_fy = existing.get("pnl_fy", [])
            cost_ratios = existing.get("cost_ratios", {})
            # Merge new records
            existing_dates_local = {d["date"] for d in all_daily}
            new_local = [r for r in new_parsed if r["date"] not in existing_dates_local]
            all_daily = sorted(all_daily + new_local, key=lambda x: x["date"])
        else:
            all_daily = sorted(new_parsed, key=lambda x: x["date"])
            pnl, pnl_fy, cost_ratios = [], [], {}

    print(f"Total daily records: {len(all_daily)}")

    # Apply VIX to any records that are missing it (vix == 0)
    missing_vix = [d for d in all_daily if not float(d.get("vix", 0) or 0)]
    if missing_vix:
        vix_start = missing_vix[0]["date"]
        vix_end   = missing_vix[-1]["date"]
        print(f"Fetching VIX for {len(missing_vix)} records missing it ({vix_start} to {vix_end})")
        vix_map = fetch_indiavix_map(vix_start, vix_end)
        if vix_map:
            for rec in all_daily:
                if not float(rec.get("vix", 0) or 0):
                    rec["vix"] = vix_map.get(rec["date"], 0)
            filled = sum(1 for r in all_daily if float(r.get("vix", 0) or 0) > 0)
            print(f"VIX applied: {filled}/{len(all_daily)} records now have VIX data")
    else:
        print("All records already have VIX data")

    # Step 5: Recompute aggregates
    quarterly = recompute_quarterly(all_daily)
    monthly   = recompute_monthly(all_daily)
    weekly    = recompute_weekly(all_daily)
    dow_avg   = recompute_dow_avg(all_daily)
    summary_obj = compute_summary(all_daily, quarterly)

    # VIX data (from daily records)
    vix_data = [{"date": d["date"], "price": float(d.get("vix", 0) or 0)}
                for d in all_daily[-120:] if float(d.get("vix", 0) or 0) > 0]

    take_rates = {"futures": TR_FUT, "options": TR_OPT, "cash": TR_CASH}

    # Step 6: Build enriched data
    enriched = compute_enriched(all_daily, quarterly, pnl)

    # Step 7: Save aggregates to Supabase
    if supabase:
        save_aggregates(supabase, "quarterly", quarterly)
        save_aggregates(supabase, "monthly", monthly)
        save_aggregates(supabase, "weekly", weekly)
        save_aggregates(supabase, "dow_avg", dow_avg)
        save_aggregates(supabase, "summary", summary_obj)
        save_aggregates(supabase, "enriched", enriched)
        new_count = len(to_insert) if 'to_insert' in dir() else 0
        log_pipeline_run(supabase, new_count, summary_obj.get("last_date", ""),
                         details=f"Total records: {len(all_daily)}")
        print("Saved aggregates to Supabase")

    # Step 8: Write local JSON files (for git commit → Vercel deploy)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    dashboard_json = build_dashboard_json(
        all_daily, quarterly, monthly, weekly, dow_avg, summary_obj,
        pnl, pnl_fy, cost_ratios, take_rates, vix_data
    )

    with open(DATA_DIR / "dashboard_data.json", "w") as f:
        json.dump(dashboard_json, f, separators=(',', ':'))
    with open(DATA_DIR / "enriched_data.json", "w") as f:
        json.dump(enriched, f, separators=(',', ':'))

    print(f"Wrote {DATA_DIR / 'dashboard_data.json'}")
    print(f"Wrote {DATA_DIR / 'enriched_data.json'}")

    # Step 9: Write data files to dashboard/data/ (for unified dashboard fetch())
    write_dashboard_data(dashboard_json, enriched)

    # Summary
    print("\n" + "=" * 60)
    print(f"Pipeline complete.")
    print(f"  Latest date: {summary_obj.get('last_date', 'N/A')}")
    print(f"  Total daily records: {len(all_daily)}")
    print(f"  Current quarter: {summary_obj.get('current_quarter', 'N/A')}")
    new_count_final = len(to_insert) if supabase and 'to_insert' in dir() else len(new_parsed)
    print(f"  New days this run: {new_count_final}")
    print("=" * 60)

    # Return count for GitHub Actions to decide if commit is needed
    return new_count_final


if __name__ == "__main__":
    count = main()
    # Write count to a file so GitHub Actions can read it
    count_file = PROJECT_ROOT / ".new_days_count"
    count_file.write_text(str(count or 0))
