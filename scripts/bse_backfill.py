"""
BSE Historical Backfill — One-time script to populate BSE data from April 2023.
Fetches all FY years via ASP.NET postback drill-down, upserts to Supabase,
then recomputes aggregates and writes JSON files.

Usage: python scripts/bse_backfill.py
"""

import sys
import re
import time
from datetime import datetime

# Import everything from the main BSE pipeline
from bse_pipeline import (
    _get_form_data, _postback, _find_postback_targets,
    _parse_fo_daily_table, _parse_cash_daily_table,
    clean_number, parse_fo_record, parse_cash_record,
    date_to_fy_quarter, date_to_fy_month, date_to_fy,
    get_supabase_client, upsert_daily_records, fetch_all_daily,
    get_existing_dates, save_aggregates, log_pipeline_run,
    recompute_quarterly, recompute_monthly, recompute_weekly,
    compute_summary, compute_enriched, build_dashboard_json,
    SUPABASE_URL, SUPABASE_KEY, DATA_DIR, DASHBOARD_DIR,
)
import json


def backfill_fo(start_fy_index=0, end_fy_index=3):
    """Fetch F&O daily data for multiple FY years via postback.
    
    Year indices on BSE page: 0=current FY, 1=previous FY, 2=two years ago, etc.
    """
    from curl_cffi import requests as cffi_requests

    session = cffi_requests.Session()
    url = "https://www.bseindia.com/markets/keystatics/Keystat_turnover_deri.aspx"

    print("Fetching BSE F&O page...")
    resp = session.get(url, impersonate="chrome")
    if resp.status_code != 200:
        print(f"ERROR: F&O page returned {resp.status_code}")
        return []

    year_targets = _find_postback_targets(resp.text, r'[^&]*gvReport_total[^&]*Linkbtn[^&]*')
    print(f"Found {len(year_targets)} FY year links")

    all_rows = []
    page_html = resp.text

    for yi in range(start_fy_index, min(end_fy_index, len(year_targets))):
        target = year_targets[yi]
        print(f"\n--- F&O: Clicking year index {yi} ({target.split('$')[-2]}) ---")

        # Click year to get months
        html_months = _postback(session, url, page_html, target)
        if not html_months:
            print(f"  Failed to get months for year index {yi}")
            page_html = resp.text  # reset
            time.sleep(2)
            resp = session.get(url, impersonate="chrome")
            page_html = resp.text
            continue

        month_targets = _find_postback_targets(html_months, r'[^&]*gvYearwise_T[^&]*lnkMonth_T[^&]*')
        print(f"  Found {len(month_targets)} month links")

        current_html = html_months
        for mi, mt in enumerate(month_targets):
            # Extract year/month context
            ctl_match = re.search(r'\$(ctl\d+)\$lnkMonth_T', mt)
            ctl_row = ctl_match.group(1) if ctl_match else f'ctl{mi+2:02d}'
            year_val = re.search(rf'{ctl_row}_hdnYear"[^>]*value="(\d+)"', current_html)
            month_val = re.search(rf'{ctl_row}_hdnMonth"[^>]*value="(\d+)"', current_html)
            ctx_year = int(year_val.group(1)) if year_val else datetime.now().year
            ctx_month = int(month_val.group(1)) if month_val else 1

            html_daily = _postback(session, url, current_html, mt)
            if not html_daily:
                print(f"  Failed month {ctx_year}-{ctx_month:02d}")
                continue

            rows = _parse_fo_daily_table(html_daily, ctx_year, ctx_month)
            all_rows.extend(rows)
            print(f"  F&O {ctx_year}-{ctx_month:02d}: {len(rows)} days")
            current_html = html_daily
            time.sleep(0.5)  # be polite

        # Reset session for next year
        time.sleep(1)
        resp = session.get(url, impersonate="chrome")
        page_html = resp.text

    print(f"\nTotal F&O rows: {len(all_rows)}")
    return all_rows


def backfill_cash(start_fy_index=0, end_fy_index=3):
    """Fetch Cash daily data for multiple FY years via postback."""
    from curl_cffi import requests as cffi_requests

    session = cffi_requests.Session()
    url = "https://www.bseindia.com/markets/Equity/EQReports/Historical_EquitySegment.aspx"

    print("\nFetching BSE Cash page...")
    resp = session.get(url, impersonate="chrome")
    if resp.status_code != 200:
        print(f"ERROR: Cash page returned {resp.status_code}")
        return []

    year_targets = _find_postback_targets(resp.text, r'[^&]*gvReport[^&]*lnkyear[^&]*')
    print(f"Found {len(year_targets)} FY year links")

    all_rows = []
    page_html = resp.text

    for yi in range(start_fy_index, min(end_fy_index, len(year_targets))):
        target = year_targets[yi]
        print(f"\n--- Cash: Clicking year index {yi} ---")

        html_months = _postback(session, url, page_html, target)
        if not html_months:
            print(f"  Failed to get months for year index {yi}")
            page_html = resp.text
            time.sleep(2)
            resp = session.get(url, impersonate="chrome")
            page_html = resp.text
            continue

        month_targets = _find_postback_targets(html_months, r'[^&]*gvYearwise[^&]*Linkbtn[^&]*')
        print(f"  Found {len(month_targets)} month links")

        current_html = html_months
        for mt in month_targets:
            html_daily = _postback(session, url, current_html, mt)
            if not html_daily:
                continue

            rows = _parse_cash_daily_table(html_daily)
            if rows:
                label = rows[0]["date"]  # first date as label
                print(f"  Cash month ({label}...): {len(rows)} days")
            all_rows.extend(rows)
            current_html = html_daily
            time.sleep(0.5)

        # Reset session for next year
        time.sleep(1)
        resp = session.get(url, impersonate="chrome")
        page_html = resp.text

    print(f"\nTotal Cash rows: {len(all_rows)}")
    return all_rows


def main():
    print("=" * 60)
    print("BSE Historical Backfill — April 2023 to Present")
    print(f"Run time: {datetime.utcnow().isoformat()}Z")
    print("=" * 60)

    # Fetch 3 FY years: 2025-2026 (index 0), 2024-2025 (1), 2023-2024 (2)
    fo_rows = backfill_fo(start_fy_index=0, end_fy_index=3)
    cash_rows = backfill_cash(start_fy_index=0, end_fy_index=3)

    if not fo_rows and not cash_rows:
        print("No data fetched. Exiting.")
        return

    # Parse and merge (same logic as bse_pipeline.main())
    cash_by_date = {}
    for rec in cash_rows:
        try:
            parsed = parse_cash_record(rec)
            cash_by_date[parsed["date"]] = parsed
        except Exception as e:
            continue

    new_parsed = []
    for rec in fo_rows:
        try:
            parsed = parse_fo_record(rec)
        except Exception as e:
            continue
        date_key = parsed["date"]
        cm = cash_by_date.get(date_key, {})
        parsed["cash_traded_value"] = cm.get("cash_traded_value", 0)
        parsed["cash_securities"] = cm.get("cash_securities", 0)
        parsed["cash_trades"] = cm.get("cash_trades", 0)
        parsed["cash_quantity"] = cm.get("cash_quantity", 0)
        parsed["cash_rev"] = cm.get("cash_rev", 0)
        parsed["total_rev"] = round(parsed["fo_rev"] + parsed["cash_rev"], 4)
        del parsed["_dt"]
        new_parsed.append(parsed)

    # Cash-only dates
    fo_dates = {r["date"] for r in new_parsed}
    for date_key, cm in cash_by_date.items():
        if date_key not in fo_dates:
            dt = datetime.strptime(date_key, "%Y-%m-%d")
            new_parsed.append({
                "date": date_key, "day": dt.strftime("%A"),
                "fy_quarter": date_to_fy_quarter(dt), "fy_month": date_to_fy_month(dt), "fy": date_to_fy(dt),
                "total_contracts": 0, "total_turnover": 0, "futures_turnover": 0,
                "options_notional_turnover": 0, "options_premium_turnover": 0,
                "fut_rev": 0, "opt_rev": 0.0, "fo_rev": 0.0,
                "cash_traded_value": cm.get("cash_traded_value", 0),
                "cash_securities": cm.get("cash_securities", 0),
                "cash_trades": cm.get("cash_trades", 0),
                "cash_quantity": cm.get("cash_quantity", 0),
                "cash_rev": cm.get("cash_rev", 0),
                "total_rev": cm.get("cash_rev", 0), "pn_ratio": 0,
            })

    # Filter to Apr 2023+
    new_parsed = [r for r in new_parsed if r["date"] >= "2023-04-01"]
    new_parsed.sort(key=lambda x: x["date"])
    print(f"\nParsed {len(new_parsed)} records (Apr 2023+)")

    # Supabase upsert
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("WARNING: No Supabase credentials. Writing local files only.")
        supabase = None
    else:
        supabase = get_supabase_client()
        existing_dates = get_existing_dates(supabase)
        to_insert = [r for r in new_parsed if r["date"] not in existing_dates]
        print(f"Existing in DB: {len(existing_dates)}, New to insert: {len(to_insert)}")
        if to_insert:
            upsert_daily_records(supabase, to_insert)
            print(f"Upserted {len(to_insert)} records")

    # Fetch all and recompute
    if supabase:
        all_daily = fetch_all_daily(supabase)
    else:
        all_daily = new_parsed

    print(f"Total daily records: {len(all_daily)}")

    quarterly = recompute_quarterly(all_daily)
    monthly = recompute_monthly(all_daily)
    weekly = recompute_weekly(all_daily)
    summary_obj = compute_summary(all_daily, quarterly)
    enriched = compute_enriched(all_daily, quarterly)

    if supabase:
        save_aggregates(supabase, "quarterly", quarterly)
        save_aggregates(supabase, "monthly", monthly)
        save_aggregates(supabase, "weekly", weekly)
        save_aggregates(supabase, "summary", summary_obj)
        save_aggregates(supabase, "enriched", enriched)
        print("Saved aggregates to Supabase")

    # Write JSON files
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    dashboard_json = build_dashboard_json(all_daily, quarterly, monthly, weekly, summary_obj)

    for path in [DATA_DIR / "bse_dashboard_data.json", DASHBOARD_DIR / "data" / "bse_dashboard_data.json"]:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(dashboard_json, f, separators=(',', ':'))
    for path in [DATA_DIR / "bse_enriched_data.json", DASHBOARD_DIR / "data" / "bse_enriched_data.json"]:
        with open(path, "w") as f:
            json.dump(enriched, f, separators=(',', ':'))

    print(f"\nBackfill complete!")
    print(f"  Date range: {all_daily[0]['date']} to {all_daily[-1]['date']}")
    print(f"  Total records: {len(all_daily)}")
    print(f"  Quarters: {len(quarterly)}")


if __name__ == "__main__":
    main()
