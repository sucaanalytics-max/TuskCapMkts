/**
 * Vercel Serverless Function: /api/live
 *
 * Proxies private GitHub raw files to the browser using a PAT stored
 * as a Vercel environment variable (GITHUB_READ_PAT).
 *
 * NSE/BSE: read from GitHub raw (workflow-committed JSON).
 * MCX: short-circuited to Supabase (relay writes mcx_snapshots from user's
 * Mac; cloud IPs are Akamai-blocked so we can't poll MCX directly).
 *
 * Query params:
 *   exchange = nse | bse | mcx
 *   file     = live | hourly | history | share | dashboard
 *
 * Example: GET /api/live?exchange=nse&file=live
 *          GET /api/live?exchange=mcx&file=live  (Supabase short-circuit)
 *          GET /api/live?exchange=bse&file=share (bse_share_analysis.json)
 */

const REPO_RAW = 'https://raw.githubusercontent.com/Research-Tusk/exchange-pipeline/main/dashboard/data';

const VALID_EXCHANGES = ['nse', 'bse', 'mcx'];

const FILE_MAP = {
  live:      (e) => `${e}_live.json`,
  hourly:    (e) => `${e}_live_hourly.json`,
  history:   (e) => `${e}_hourly_history.json`,
  share:     (e) => `${e}_share_analysis.json`,   // exchange-aware (was hardcoded to bse)
  dashboard: (e) => `${e}_dashboard_data.json`,
};

// MCX live state lives in Supabase, not in a GitHub-committed JSON. Pull the
// latest snapshot row and return a shape compatible with what the dashboard
// expects from {nse,bse}_live.json.
async function fetchMCXLiveFromSupabase() {
  const url = process.env.MCX_SUPABASE_URL;
  const key = process.env.MCX_SUPABASE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(
      `${url}/rest/v1/mcx_snapshots?select=*&order=captured_at.desc&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;
    const s = rows[0];
    return {
      source: 'mcx_relay_supabase',
      updated_at: s.captured_at,
      trading_date: s.trading_date,
      revenue: {
        total_revenue: s.proj_total_rev ?? s.total_rev_cr ?? null,
        trade_date:    s.trading_date,
        has_data:      true,
        source:        'mcx_relay',
      },
      snapshot: s,
    };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  const exchange = (req.query.exchange || 'nse').toLowerCase();
  const file     = (req.query.file     || 'live').toLowerCase();

  if (!VALID_EXCHANGES.includes(exchange) || !FILE_MAP[file]) {
    return res.status(400).json({ error: 'Invalid exchange or file param' });
  }

  // MCX live: short-circuit to Supabase (no static JSON exists for MCX live).
  if (exchange === 'mcx' && file === 'live') {
    const data = await fetchMCXLiveFromSupabase();
    if (!data) {
      return res.status(502).json({ error: 'MCX Supabase fetch failed or empty' });
    }
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(data);
  }

  const filename = FILE_MAP[file](exchange);
  const url      = `${REPO_RAW}/${filename}`;

  const pat = process.env.GITHUB_READ_PAT;
  if (!pat) {
    return res.status(500).json({ error: 'GITHUB_READ_PAT env var not set' });
  }

  try {
    const ghRes = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept':        'application/json',
        'User-Agent':    'exchange-pipeline-dashboard',
      },
    });

    if (!ghRes.ok) {
      return res.status(502).json({ error: `GitHub returned ${ghRes.status} for ${filename}` });
    }

    const data = await ghRes.json();

    // 30-second edge cache; fresh within one polling interval
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(data);

  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
