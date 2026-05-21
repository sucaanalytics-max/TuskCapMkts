"""
Shared hourly snapshot + prediction logic for NSE and BSE live pollers.

Prediction hierarchy (best available wins):
  1. Weekday-specific historical fractions (same weekday type, ≥3 samples)
  2. Overall historical fractions (any weekday, ≥3 days)
  3. Linear fallback: revenue_so_far × (375 / elapsed_min)

Weekday classification per exchange:
  NSE: Tuesday = expiry day. If Tuesday is a holiday, Monday becomes expiry.
       Monday (before a Tuesday expiry) = pre-expiry.
  BSE: Thursday = expiry day. If Thursday is a holiday, Wednesday becomes expiry.
       Wednesday (before a Thursday expiry) = pre-expiry.

Each archived day records:
  weekday (0=Mon … 4=Fri), day_type ('expiry'|'pre_expiry'|'normal'),
  eod_revenue, and per-hour fractions.

Over time the model learns separate intraday curves for:
  expiry / pre_expiry / normal days — and within each, per-weekday if
  enough samples accumulate.

Historical file: dashboard/data/{exchange}_hourly_history.json
  {
    "days": [
      {
        "date":        "2026-04-15",
        "weekday":     1,          // 0=Mon … 4=Fri
        "weekday_name":"Tuesday",
        "day_type":    "expiry",   // "expiry"|"pre_expiry"|"normal"
        "eod_revenue": 92.3,
        "snapshots": [
          {"hour_label":"10:00","total_revenue":28.1,"fraction":0.305},
          ...
          {"hour_label":"15:30","total_revenue":92.3,"fraction":1.0}
        ]
      }
    ]
  }
"""

import json
from datetime import date, timedelta
from pathlib import Path

MARKET_OPEN_MIN  = 9 * 60 + 15   # 9:15 AM IST
MARKET_TOTAL_MIN = 375            # → 15:30
MIN_SAMPLES      = 3              # minimum days to use historical fractions

WEEKDAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]

# NSE expiry = Tuesday (1); BSE expiry = Thursday (3)
EXPIRY_WEEKDAY = {"nse": 1, "bse": 3}
# Pre-expiry = day before expiry
PRE_EXPIRY_WEEKDAY = {"nse": 0, "bse": 2}


# ---------------------------------------------------------------------------
# Day-type classification
# ---------------------------------------------------------------------------

def classify_day(d: date, exchange: str, market_dates: set = None) -> str:
    """
    Returns 'expiry', 'pre_expiry', or 'normal'.

    market_dates: optional set of YYYY-MM-DD strings of known trading days.
    Used to detect holiday shifts (e.g. Tuesday holiday → Monday becomes expiry).
    When not provided, uses simple weekday rules.
    """
    wd = d.weekday()   # 0=Mon … 4=Fri
    exp_wd = EXPIRY_WEEKDAY.get(exchange, -1)
    pre_wd = PRE_EXPIRY_WEEKDAY.get(exchange, -1)

    if market_dates:
        # Find the canonical expiry day of the same week
        days_to_exp = (exp_wd - wd) % 7
        canonical_expiry = d + timedelta(days=days_to_exp)
        canonical_str = canonical_expiry.strftime("%Y-%m-%d")

        # Only apply holiday-shift logic if the canonical expiry is in the past
        # (i.e. we would already have it in market_dates if it were a trading day).
        # If it's today or in the future we can't know yet → use simple weekday rule.
        max_known = max(market_dates) if market_dates else ""
        expiry_is_holiday = (canonical_str <= max_known) and (canonical_str not in market_dates)

        if expiry_is_holiday:
            # Expiry shifts to the trading day just before canonical expiry
            # that day is the new expiry
            shifted = canonical_expiry - timedelta(days=1)
            while shifted.strftime("%Y-%m-%d") not in market_dates and shifted > d:
                shifted -= timedelta(days=1)
            if d == shifted:
                return "expiry"
            # Pre-expiry = day before shifted expiry
            pre_shifted = shifted - timedelta(days=1)
            while pre_shifted.strftime("%Y-%m-%d") not in market_dates and pre_shifted > d:
                pre_shifted -= timedelta(days=1)
            if d == pre_shifted:
                return "pre_expiry"
        else:
            if wd == exp_wd:
                return "expiry"
            # Pre-expiry = closest trading day before canonical expiry
            pre = canonical_expiry - timedelta(days=1)
            while pre.weekday() > 4:   # skip weekends
                pre -= timedelta(days=1)
            if d == pre:
                return "pre_expiry"
    else:
        # Simple weekday rule (no holiday awareness)
        if wd == exp_wd:
            return "expiry"
        if wd == pre_wd:
            return "pre_expiry"

    return "normal"


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def hourly_label(now_ist):
    h, m = now_ist.hour, now_ist.minute
    if h == 15 and 28 <= m <= 35:
        return "15:30"
    if h in (10, 11, 12, 13, 14, 15) and m < 5:
        return f"{h:02d}:00"
    return None


def elapsed_for_label(label):
    h, m = map(int, label.split(":"))
    return h * 60 + m - MARKET_OPEN_MIN


def _load_history(history_file: Path):
    if history_file.exists():
        try:
            return json.loads(history_file.read_text())
        except Exception:
            pass
    return {"days": []}


# ---------------------------------------------------------------------------
# Fraction computation (overall + weekday-filtered)
# ---------------------------------------------------------------------------

def _avg_fractions(days: list) -> dict:
    """Average per-hour fractions across a list of day records."""
    from collections import defaultdict
    label_fracs = defaultdict(list)
    for day in days:
        for snap in day.get("snapshots", []):
            frac = snap.get("fraction")
            if frac is not None and snap.get("hour_label"):
                label_fracs[snap["hour_label"]].append(frac)
    return {
        lbl: round(sum(fs) / len(fs), 4)
        for lbl, fs in label_fracs.items() if fs
    }


def _best_fractions(label: str, history_file: Path, today_day_type: str, today_weekday: int):
    """
    Returns (avg_fraction, method_label) using the best available sample set.

    Priority:
      1. Same day_type + same weekday (most specific)
      2. Same day_type (e.g. all expiry days regardless of weekday)
      3. All days overall
      4. None → caller uses linear
    """
    data = _load_history(history_file)
    all_days = [d for d in data.get("days", []) if d.get("eod_revenue", 0) > 0]

    def try_set(days, method):
        if len(days) < MIN_SAMPLES:
            return None, None
        fracs = _avg_fractions(days)
        f = fracs.get(label)
        return (f, method) if f else (None, None)

    # 1. Same day_type + same weekday
    specific = [d for d in all_days
                if d.get("day_type") == today_day_type and d.get("weekday") == today_weekday]
    f, m = try_set(specific, f"historical/{today_day_type}/wd{today_weekday}")
    if f:
        return f, m

    # 2. Same day_type
    typed = [d for d in all_days if d.get("day_type") == today_day_type]
    f, m = try_set(typed, f"historical/{today_day_type}")
    if f:
        return f, m

    # 3. All days
    f, m = try_set(all_days, "historical/overall")
    if f:
        return f, m

    return None, None


# ---------------------------------------------------------------------------
# Public: predict EOD
# ---------------------------------------------------------------------------

def predict_eod(revenue_so_far, label, history_file: Path,
                today_day_type: str = "normal", today_weekday: int = 0):
    if not revenue_so_far or revenue_so_far <= 0:
        return None, "none"
    elapsed = elapsed_for_label(label)
    if elapsed <= 0:
        return None, "none"

    avg_frac, method = _best_fractions(label, history_file, today_day_type, today_weekday)

    if avg_frac and avg_frac > 0:
        return round(revenue_so_far / avg_frac, 2), method
    else:
        return round(revenue_so_far * MARKET_TOTAL_MIN / elapsed, 2), "linear"


# ---------------------------------------------------------------------------
# Public: archive day to history
# ---------------------------------------------------------------------------

def archive_day_to_history(hourly_file: Path, history_file: Path, exchange: str = "nse"):
    if not hourly_file.exists():
        return

    try:
        today_data = json.loads(hourly_file.read_text())
    except Exception:
        return

    today_date_str = today_data.get("date")       # "2026-04-15"
    snaps          = today_data.get("snapshots", [])

    eod_snap = next((s for s in snaps if s.get("hour_label") == "15:30"), None)
    if not eod_snap or not eod_snap.get("has_data"):
        return

    eod_rev = eod_snap.get("total_revenue") or 0
    if eod_rev <= 0:
        return

    history = _load_history(history_file)
    days    = history.get("days", [])

    if any(d.get("date") == today_date_str for d in days):
        print(f"  History: {today_date_str} already archived — skipping")
        return

    # Build known trading dates from history (for holiday-shift detection)
    market_dates = {d["date"] for d in days}
    market_dates.add(today_date_str)

    today_date = date.fromisoformat(today_date_str)
    weekday    = today_date.weekday()
    day_type   = classify_day(today_date, exchange, market_dates)

    snaps_archived = []
    for s in snaps:
        rev = s.get("total_revenue") or 0
        snaps_archived.append({
            "hour_label":    s["hour_label"],
            "total_revenue": rev,
            "fraction":      round(rev / eod_rev, 4) if eod_rev else None,
        })

    days.append({
        "date":         today_date_str,
        "weekday":      weekday,
        "weekday_name": WEEKDAY_NAMES[weekday],
        "day_type":     day_type,
        "eod_revenue":  eod_rev,
        "snapshots":    snaps_archived,
    })
    history["days"] = sorted(days, key=lambda d: d["date"])[-60:]

    history_file.parent.mkdir(parents=True, exist_ok=True)
    history_file.write_text(json.dumps(history, indent=2))
    n = len(history["days"])
    print(f"  History: archived {today_date_str} [{WEEKDAY_NAMES[weekday]}/{day_type}] "
          f"EOD ₹{eod_rev} Cr — {n} days total")


# ---------------------------------------------------------------------------
# Public: save hourly snapshot
# ---------------------------------------------------------------------------

def save_hourly_snapshot(revenue, now_ist, hourly_file: Path, history_file: Path,
                         exchange: str = "nse"):
    label = hourly_label(now_ist)
    if label is None:
        return

    today_str  = now_ist.strftime("%Y-%m-%d")
    today_date = now_ist.date()
    weekday    = today_date.weekday()

    # Load known market dates for holiday-shift detection
    hist_data    = _load_history(history_file)
    market_dates = {d["date"] for d in hist_data.get("days", [])}
    market_dates.add(today_str)
    day_type = classify_day(today_date, exchange, market_dates)

    existing = {}
    if hourly_file.exists():
        try:
            existing = json.loads(hourly_file.read_text())
        except Exception:
            existing = {}

    if existing.get("date") != today_str:
        existing = {"date": today_str, "weekday": weekday,
                    "weekday_name": WEEKDAY_NAMES[weekday], "day_type": day_type,
                    "snapshots": []}

    snaps = existing.get("snapshots", [])
    if any(s["hour_label"] == label for s in snaps):
        print(f"  Hourly snapshot {label} already recorded — skipping")
        if label == "15:30":
            archive_day_to_history(hourly_file, history_file, exchange)
        return

    total_rev = round(float(revenue.get("total_revenue") or 0), 2) if revenue else None
    pred, method = predict_eod(total_rev, label, history_file, day_type, weekday)

    snap = {
        "hour_label":      label,
        "captured_ist":    now_ist.strftime("%Y-%m-%dT%H:%M:%S"),
        "elapsed_minutes": elapsed_for_label(label),
        "total_revenue":   total_rev,
        "cash_revenue":    round(float(revenue.get("cash_revenue")    or 0), 2) if revenue else None,
        "options_revenue": round(float(revenue.get("options_revenue")  or 0), 2) if revenue else None,
        "futures_revenue": round(float(revenue.get("futures_revenue")  or 0), 2) if revenue else None,
        "has_data":        bool(revenue and revenue.get("has_data")),
        "predicted_eod":   pred,
        "pred_method":     method,
    }
    snaps.append(snap)
    snaps.sort(key=lambda x: x["hour_label"])
    existing["snapshots"] = snaps

    hourly_file.parent.mkdir(parents=True, exist_ok=True)
    hourly_file.write_text(json.dumps(existing, indent=2))
    print(f"  [{WEEKDAY_NAMES[weekday]}/{day_type}] {label} — "
          f"₹{total_rev} Cr, pred EOD ₹{pred} Cr [{method}]")

    if label == "15:30":
        archive_day_to_history(hourly_file, history_file, exchange)
