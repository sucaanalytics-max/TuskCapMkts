/**
 * Vercel Serverless Function: /api/revenue
 *
 * Fetches today's live revenue directly from NSE and BSE APIs.
 * BSE: calls api.bseindia.com directly (standard headers, no TLS fingerprinting needed).
 * NSE: attempts session-bootstrapped fetch; falls back to GitHub-hosted nse_live.json.
 *
 * Returns: { nse: { total_revenue, trade_date, has_data, source }, bse: {...}, fetched_at }
 */

const GITHUB_RAW = 'https://raw.githubusercontent.com/Research-Tusk/exchange-pipeline/main/dashboard/data';

// Take rates (both sides of transaction)
const TR_FUT_NSE  = 0.00173 / 100 * 2;
const TR_OPT_NSE  = 0.03503 / 100 * 2;
const TR_CASH_NSE = 0.00297 / 100 * 2;
const TR_CASH_BSE = 0.00375 / 100 * 2;
const TR_OPT_BSE  = 0.03250 / 100 * 2;

// ── NSE ──────────────────────────────────────────────────────────────────────

async function fetchNSEDirect() {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Step 1: bootstrap session to get cookies
  const homeRes = await fetch('https://www.nseindia.com/', {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(12000),
  });

  // Collect Set-Cookie values (Node 18+ returns an iterable via getSetCookie())
  let cookies = '';
  if (typeof homeRes.headers.getSetCookie === 'function') {
    cookies = homeRes.headers.getSetCookie().join('; ');
  } else {
    cookies = homeRes.headers.get('set-cookie') || '';
  }

  // Step 2: call live turnover summary
  const apiRes = await fetch(
    'https://www.nseindia.com/api/NextApi/apiClient?functionName=getMarketTurnoverSummary',
    {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/',
        'Cookie': cookies,
      },
      signal: AbortSignal.timeout(12000),
    }
  );

  if (!apiRes.ok) return null;
  const body = await apiRes.json();
  const raw = body?.data || {};

  const eq_deriv = raw.equityDerivatives || [];
  const equities = raw.equities || [];

  function find(arr, name) { return arr.find(x => x.instrument === name) || {}; }
  function cr(v) { return Math.round(parseFloat(v || 0) / 1e7 * 100) / 100; }

  const if_val   = cr(find(eq_deriv, 'Index Futures').value);
  const sf_val   = cr(find(eq_deriv, 'Stock Futures').value);
  const io_prem  = cr(find(eq_deriv, 'Index Options').premiumTurnover);
  const so_prem  = cr(find(eq_deriv, 'Stock Options').premiumTurnover);
  const cash_val = cr(find(equities,  'Equity').value);

  const fut_turnover = if_val + sf_val;
  const opt_premium  = io_prem + so_prem;
  const fut_rev      = fut_turnover * TR_FUT_NSE;
  const opt_rev      = opt_premium  * TR_OPT_NSE;
  const cash_rev     = cash_val     * TR_CASH_NSE;
  const total_rev    = fut_rev + opt_rev + cash_rev;
  const has_data     = !!(fut_turnover || opt_premium || cash_val);

  const ts = find(eq_deriv, 'Index Futures').mktTimeStamp
          || find(equities,  'Equity').mktTimeStamp
          || '';
  const trade_date = ts ? ts.slice(0, 10) : (raw.asOnDate || '');

  return {
    total_revenue: Math.round(total_rev * 100) / 100,
    trade_date,
    has_data,
    source: 'direct',
  };
}

// ── BSE ──────────────────────────────────────────────────────────────────────

async function fetchBSEDirect() {
  const res = await fetch('https://api.bseindia.com/BseIndiaAPI/api/MTurnover/w', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.bseindia.com/',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://www.bseindia.com',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) return null;
  const body = await res.json();
  const rows = body?.Data || [];

  function find(name) { return rows.find(r => r.HeaderName?.toLowerCase() === name.toLowerCase()) || {}; }
  function parse(val) {
    if (!val || String(val).trim() === '-') return 0;
    return parseFloat(String(val).replace(/,/g, '')) || 0;
  }

  const eq    = find('Equity');
  const deriv = find('Derivatives');

  const eq_turnover   = parse(eq.Turnover);
  const deriv_premium = parse(deriv.PermiumTurnover);

  const cash_rev  = eq_turnover   * TR_CASH_BSE;
  const opt_rev   = deriv_premium * TR_OPT_BSE;
  const total_rev = cash_rev + opt_rev;
  const has_data  = !!(eq_turnover || deriv_premium);

  // BSE Ason format: "DD/MM/YY" e.g. "13/04/26"
  const ason = eq.Ason || deriv.Ason || '';
  let trade_date = '';
  if (ason && ason.match(/^\d{2}\/\d{2}\/\d{2}/)) {
    const [dd, mm, yy] = ason.slice(0, 8).split('/');
    trade_date = `20${yy}-${mm}-${dd}`;
  }

  return {
    total_revenue: Math.round(total_rev * 100) / 100,
    trade_date,
    has_data,
    source: 'direct',
  };
}

// ── GitHub fallback ───────────────────────────────────────────────────────────

async function fetchGitHubFallback(exchange) {
  const pat = process.env.GITHUB_READ_PAT;
  if (!pat) return null;
  try {
    const res = await fetch(`${GITHUB_RAW}/${exchange}_live.json`, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/json',
        'User-Agent': 'exchange-pipeline-dashboard',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rev = data?.revenue;
    if (!rev) return null;
    return { ...rev, source: 'github' };
  } catch {
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  const [nseSettled, bseSettled] = await Promise.allSettled([
    fetchNSEDirect().catch(() => null),
    fetchBSEDirect().catch(() => null),
  ]);

  let nse = nseSettled.status === 'fulfilled' ? nseSettled.value : null;
  let bse = bseSettled.status === 'fulfilled' ? bseSettled.value : null;

  // Fall back to GitHub-hosted live JSON if direct fetch failed or has no data
  const [nseFallback, bseFallback] = await Promise.all([
    (!nse?.has_data) ? fetchGitHubFallback('nse').catch(() => null) : Promise.resolve(null),
    (!bse?.has_data) ? fetchGitHubFallback('bse').catch(() => null) : Promise.resolve(null),
  ]);

  if (!nse?.has_data && nseFallback) nse = nseFallback;
  if (!bse?.has_data && bseFallback) bse = bseFallback;

  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ nse, bse, fetched_at: new Date().toISOString() });
};
