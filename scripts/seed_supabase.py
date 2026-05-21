"""
Seed Supabase with existing dashboard data.
Run once to populate the database with historical records.

Usage:
  export SUPABASE_URL="https://xxxx.supabase.co"
  export SUPABASE_KEY="your-service-role-key"
  python scripts/seed_supabase.py
"""

import json
import os
import sys
from pathlib import Path

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_KEY environment variables")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    data_file = DATA_DIR / "dashboard_data.json"
    if not data_file.exists():
        print(f"ERROR: {data_file} not found. Copy your existing dashboard_data.json to data/")
        sys.exit(1)

    with open(data_file) as f:
        data = json.load(f)

    # ── 1. Seed nse_daily ──
    daily_all = data.get("daily_all", data.get("daily", []))
    print(f"Seeding {len(daily_all)} daily records...")

    # Remove fields that don't exist in the table
    exclude = {"created_at", "updated_at"}
    batch_size = 100
    for i in range(0, len(daily_all), batch_size):
        batch = daily_all[i:i+batch_size]
        clean = [{k: v for k, v in r.items() if k not in exclude} for r in batch]
        supabase.table("nse_daily").upsert(clean, on_conflict="date").execute()
        print(f"  Upserted {min(i + batch_size, len(daily_all))}/{len(daily_all)}")

    # ── 2. Seed nse_pnl ──
    pnl = data.get("pnl", [])
    if pnl:
        print(f"Seeding {len(pnl)} P&L records...")
        supabase.table("nse_pnl").upsert(pnl, on_conflict="quarter").execute()

    # ── 3. Seed nse_pnl_fy ──
    pnl_fy = data.get("pnl_fy", [])
    if pnl_fy:
        print(f"Seeding {len(pnl_fy)} P&L FY records...")
        supabase.table("nse_pnl_fy").upsert(pnl_fy, on_conflict="fy").execute()

    # ── 4. Seed nse_cost_ratios ──
    cost_ratios = data.get("cost_ratios", {})
    if cost_ratios:
        print(f"Seeding {len(cost_ratios)} cost ratio records...")
        cr_rows = [{"quarter": k, **v} for k, v in cost_ratios.items()]
        supabase.table("nse_cost_ratios").upsert(cr_rows, on_conflict="quarter").execute()

    print("\nSeed complete.")
    print(f"  Daily records: {len(daily_all)}")
    print(f"  P&L quarters:  {len(pnl)}")
    print(f"  P&L FY:        {len(pnl_fy)}")
    print(f"  Cost ratios:   {len(cost_ratios)}")


if __name__ == "__main__":
    main()
