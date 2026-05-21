/**
 * Vercel Serverless Function: /api/live
 *
 * Proxies private GitHub raw files to the browser using a PAT stored
 * as a Vercel environment variable (GITHUB_READ_PAT).
 *
 * Query params:
 *   exchange = nse | bse
 *   file     = live | hourly | history | share
 *
 * Example: GET /api/live?exchange=nse&file=live
 */

const REPO_RAW = 'https://raw.githubusercontent.com/Research-Tusk/exchange-pipeline/main/dashboard/data';

const VALID_EXCHANGES = ['nse', 'bse'];

const FILE_MAP = {
  live:    (e) => `${e}_live.json`,
  hourly:  (e) => `${e}_live_hourly.json`,
  history: (e) => `${e}_hourly_history.json`,
  share:   ()  => 'bse_share_analysis.json',
};

module.exports = async function handler(req, res) {
  const exchange = (req.query.exchange || 'nse').toLowerCase();
  const file     = (req.query.file     || 'live').toLowerCase();

  if (!VALID_EXCHANGES.includes(exchange) || !FILE_MAP[file]) {
    return res.status(400).json({ error: 'Invalid exchange or file param' });
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
