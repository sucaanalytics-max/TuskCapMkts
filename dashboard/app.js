// app.js — Unified NSE+BSE Analytics Dashboard
// Data loaded dynamically from ./data/ via fetch()

// ========================
// GLOBAL STATE
// ========================

let DATA = {};
let ENRICHED_DATA = {};
let SHARE_DATA = null;   // BSE Ltd share price analysis
let currentExchange = 'nse';
const charts = {};

// ========================
// UTILITIES
// ========================

function fmt(num, decimals = 1) {
  if (num == null || isNaN(num)) return '—';
  const n = Number(num);
  return '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' Cr';
}

function fmtNum(num, decimals = 1) {
  if (num == null || isNaN(num)) return '—';
  return Number(num).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(num) {
  if (num == null || isNaN(num)) return '—';
  const pct = (Number(num) * 100).toFixed(1);
  return pct + ' %';
}

function fmtPctRaw(num) {
  if (num == null || isNaN(num)) return '—';
  return Number(num).toFixed(1) + ' %';
}

function fmtPctSigned(val) {
  if (val == null || isNaN(val)) return '<span class="neutral">—</span>';
  const abs = Math.abs(Number(val) * 100).toFixed(1);
  const sign = val > 0.001 ? '+' : val < -0.001 ? '−' : '';
  const cls = val > 0.001 ? 'positive' : val < -0.001 ? 'negative' : 'neutral';
  return `<span class="${cls}">${sign}${abs} %</span>`;
}

function deltaClass(val) {
  if (val > 0.001) return 'positive';
  if (val < -0.001) return 'negative';
  return 'neutral';
}

function deltaStr(val) {
  if (val == null || isNaN(val)) return '';
  const abs = Math.abs(val * 100).toFixed(1);
  const arrow = val > 0 ? '▲' : val < 0 ? '▼' : '—';
  return abs + ' % ' + arrow;
}

function fmtPrice(num) {
  if (num == null || isNaN(num)) return '—';
  return '₹ ' + Number(num).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ========================
// CHART COLORS — from CSS tokens
// ========================

function getChartColors() {
  const s = getComputedStyle(document.documentElement);
  return [
    s.getPropertyValue('--chart-1').trim(),
    s.getPropertyValue('--chart-2').trim(),
    s.getPropertyValue('--chart-3').trim(),
    s.getPropertyValue('--chart-4').trim(),
    s.getPropertyValue('--chart-5').trim(),
    s.getPropertyValue('--chart-6').trim(),
  ];
}
const CHART_COLORS = ['#2563EB', '#C0392B', '#16A34A', '#7C3AED', '#D97706', '#0891B2'];
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', system-ui, sans-serif";

function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function getGridColor() {
  return getTheme() === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
}

function getTickColor() {
  return getTheme() === 'light' ? '#6e6e73' : '#86868b';
}

function getTooltipBg() {
  return getTheme() === 'light' ? 'rgba(255, 255, 255, 0.95)' : 'rgba(28, 28, 30, 0.95)';
}

function getTooltipText() {
  return getTheme() === 'light' ? '#1d1d1f' : '#f5f5f7';
}

function getDonutBorderColor() {
  return getTheme() === 'light' ? '#f5f5f7' : '#1c1c1e';
}

function getScaleBorderColor() {
  return getTheme() === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
}

function getHeatmapRgb() {
  return '0, 113, 227';
}

function applyChartDefaults() {
  Chart.defaults.color = getTickColor();
  Chart.defaults.font.family = FONT_FAMILY;
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.backgroundColor = getTooltipBg();
  Chart.defaults.plugins.tooltip.titleColor = getTooltipText();
  Chart.defaults.plugins.tooltip.bodyColor = getTooltipText();
  Chart.defaults.plugins.tooltip.borderColor = getTheme() === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleFont = { size: 11, weight: '600' };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 11 };
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.scale.grid = { color: getGridColor() };
  Chart.defaults.scale.border = { color: getScaleBorderColor() };
  Chart.defaults.elements.line.tension = 0.3;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.animation.duration = 700;
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
}

applyChartDefaults();

function setCanvasHeight(id, h) {
  const c = document.getElementById(id);
  if (c) c.parentElement.style.height = h + 'px';
}

// ========================
// THEME TOGGLE
// ========================

function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  toggle.addEventListener('click', () => {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    updateChartsForTheme();
  });
}

function updateChartsForTheme() {
  applyChartDefaults();
  Object.entries(charts).forEach(([key, chart]) => {
    if (!chart) return;
    if (chart.options && chart.options.scales) {
      Object.values(chart.options.scales).forEach(scale => {
        if (scale.grid) scale.grid.color = getGridColor();
        if (scale.border) scale.border.color = getScaleBorderColor();
        if (scale.ticks) scale.ticks.color = getTickColor();
      });
    }
    if (chart.options && chart.options.plugins && chart.options.plugins.tooltip) {
      chart.options.plugins.tooltip.backgroundColor = getTooltipBg();
      chart.options.plugins.tooltip.titleColor = getTooltipText();
      chart.options.plugins.tooltip.bodyColor = getTooltipText();
      chart.options.plugins.tooltip.borderColor = getTheme() === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
    }
    if (key === 'donut' && chart.data && chart.data.datasets[0]) {
      chart.data.datasets[0].borderColor = getDonutBorderColor();
      chart.data.datasets[0].hoverBorderColor = getDonutBorderColor();
    }
    chart.update('none');
  });
  // Rebuild heatmap if NSE
  const hm = document.getElementById('heatmapContainer');
  if (currentExchange === 'nse' && hm && hm.innerHTML) {
    buildHeatmap();
  }
}

// Theme toggle removed — light mode only

// ========================
// LOADING OVERLAY
// ========================

function showLoading(exchange) {
  const overlay = document.getElementById('loadingOverlay');
  document.getElementById('loadingText').textContent = 'Loading ' + exchange.toUpperCase() + ' data...';
  overlay.classList.add('visible');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('visible');
}

// ========================
// NAV ICONS (SVG strings)
// ========================

const NAV_ICONS = {
  revenue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>',
  segment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/><path d="M2 12h20"/></svg>',
  temporal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  prediction: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  advanced: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
};

// ========================
// TAB DEFINITIONS PER EXCHANGE
// ========================

const EXCHANGE_TABS = {
  nse: [
    { id: 'revenue',    label: 'Revenue Summary',    icon: 'revenue' },
    { id: 'prediction', label: 'PAT Prediction',      icon: 'prediction' },
  ],
  bse: [
    { id: 'revenue',    label: 'Revenue Summary',     icon: 'revenue' },
    { id: 'prediction', label: 'Revenue Predictor',    icon: 'prediction' },
    { id: 'share',      label: 'Regression',            icon: 'share' },
  ],
  mcx: [
    { id: 'revenue',    label: 'Revenue Summary',     icon: 'revenue' },
    { id: 'prediction', label: 'Revenue Predictor',    icon: 'prediction' },
    { id: 'share',      label: 'Regression',            icon: 'share' },
  ],
};

const TAB_TITLES = {
  nse: {
    revenue: 'Revenue Summary',
    prediction: 'PAT Prediction Engine',
  },
  bse: {
    revenue: 'Revenue Summary',
    prediction: 'Revenue Predictor',
    share: 'Share Price Analytics',
  },
  mcx: {
    revenue: 'Revenue Summary',
    prediction: 'Revenue Predictor',
    share: 'Share Price Analytics',
  },
};

// ========================
// SIDEBAR NAV BUILDER
// ========================

function buildSidebarNav(exchange) {
  const nav = document.getElementById('sidebarNav');
  const tabs = EXCHANGE_TABS[exchange];
  nav.innerHTML = tabs.map((t, i) =>
    `<button class="nav-item${i === 0 ? ' active' : ''}" data-tab="${t.id}" aria-label="${t.label}">
      ${NAV_ICONS[t.icon]}
      ${t.label}
    </button>`
  ).join('');
  attachTabListeners();
}

// ========================
// TAB NAVIGATION
// ========================

function attachTabListeners() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      const tabEl = document.getElementById('tab-' + tab);
      if (tabEl) tabEl.classList.add('active');
      const titles = TAB_TITLES[currentExchange] || {};
      document.getElementById('headerTitle').textContent = titles[tab] || tab;
      // Close mobile nav
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarOverlay').classList.remove('open');
      // Resize charts after tab switch
      setTimeout(() => {
        Object.values(charts).forEach(c => { if (c && c.resize) c.resize(); });
      }, 50);
    });
  });
}

// Sub-tabs — use event delegation since content is dynamic
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.sub-tab');
  if (!btn) return;
  const st = btn.dataset.subtab;
  if (!st) return;
  const container = btn.closest('.tab-content');
  // Deactivate siblings
  btn.parentElement.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Find the correct scope for sub-content toggling
  const scope = container;
  if (!scope) return;
  scope.querySelectorAll('.sub-content').forEach(c => c.classList.remove('active'));
  const target = document.getElementById('subtab-' + st);
  if (target) target.classList.add('active');
  setTimeout(() => {
    Object.values(charts).forEach(c => { if (c && c.resize) c.resize(); });
  }, 50);
});

// Mobile nav
document.getElementById('mobileNavToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
});
document.getElementById('sidebarOverlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
});

// ========================
// EXCHANGE SWITCHER
// ========================

function initExchangeSwitcher() {
  document.querySelectorAll('.exchange-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const exchange = btn.dataset.exchange;
      if (exchange === currentExchange) return;
      document.querySelectorAll('.exchange-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await switchExchange(exchange);
    });
  });
}

async function switchExchange(exchange) {
  showLoading(exchange);
  // Destroy all existing charts
  Object.values(charts).forEach(c => { if (c && c.destroy) c.destroy(); });
  Object.keys(charts).forEach(k => delete charts[k]);
  currentExchange = exchange;
  // Update logo
  document.getElementById('logoText').textContent = exchange.toUpperCase() + ' Analytics';
  // Update sidebar nav
  buildSidebarNav(exchange);
  // Show/hide exchange-specific content sections
  toggleExchangeContent(exchange);
  // Load data
  await loadExchangeData(exchange);
  // Update header info
  updateHeaderInfo();
  // Build all visualizations
  rebuildAll();
  hideLoading();
  // Activate first tab
  const firstNavItem = document.querySelector('.nav-item[data-tab]');
  if (firstNavItem) firstNavItem.click();
}

function toggleExchangeContent(exchange) {
  const isNSE = exchange === 'nse';
  const isBSE = exchange === 'bse';
  const isMCX = exchange === 'mcx';

  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  };

  // NSE-only sections
  show('nseSegmentContent',   isNSE);
  show('nseTemporalContent',  isNSE);
  show('nseAdvancedContent',  isNSE);
  show('nseExecExtras',       isNSE);
  show('nsePredictionContent', isNSE);

  // BSE-only sections
  show('bseSegmentContent',   isBSE);
  show('bseQuarterlyContent', isBSE);
  show('bseMonthlyContent',   isBSE);
  show('bseExecExtras',       isBSE);
  show('bsePredictionContent', isBSE);
  show('bse-share-inner',     isBSE);

  // MCX-only sections
  show('mcxPredictionContent', isMCX);
  show('mcx-share-inner',      isMCX);
}

// ========================
// DATA LOADING
// ========================

async function loadExchangeData(exchange) {
  const fetches = [
    fetch(`./data/${exchange}_dashboard_data.json`),
    fetch(`./data/${exchange}_enriched_data.json`),
  ];
  if (exchange === 'bse' || exchange === 'mcx') {
    fetches.push(fetch(`./data/${exchange}_share_analysis.json`).catch(() => null));
  }
  const results = await Promise.all(fetches);
  DATA = await results[0].json();
  ENRICHED_DATA = await results[1].json();
  if ((exchange === 'bse' || exchange === 'mcx') && results[2]) {
    SHARE_DATA = await results[2].json().catch(() => null);
  } else {
    SHARE_DATA = null;
  }
}

// ========================
// HEADER INFO UPDATE
// ========================

function updateHeaderInfo() {
  const dailyAll = DATA.daily_all || DATA.daily;
  if (dailyAll && dailyAll.length > 0) {
    const lastDate = dailyAll[dailyAll.length - 1].date;
    const d = new Date(lastDate + 'T00:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formatted = ('0' + d.getDate()).slice(-2) + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    const span = document.getElementById('lastUpdatedSpan');
    if (span) span.textContent = 'Last Updated: ' + formatted;
  }
  const cqSpan = document.getElementById('currentQuarterSpan');
  if (cqSpan && DATA.summary) {
    cqSpan.textContent = DATA.summary.current_quarter;
  }
}

// ========================
// LATEST REVENUE BANNER
// ========================

async function updateLatestRevBanner() {
  const el = document.getElementById('latestRevBanner');
  if (!el) return;

  const bust = Date.now();
  let nse = null, bse = null;

  // 1. Try /api/revenue — fetches directly from NSE & BSE websites on demand
  try {
    const res = await fetch('/api/revenue?t=' + bust);
    if (res.ok) {
      const data = await res.json();
      nse = data.nse;
      bse = data.bse;
    }
  } catch(e) { /* fall through */ }

  // 2. Fall back to /api/live (GitHub-hosted live JSON, updated every 5 min by Actions)
  const needNse = !nse || !nse.has_data;
  const needBse = !bse || !bse.has_data;
  if (needNse || needBse) {
    const [nseRes, bseRes] = await Promise.all([
      needNse ? fetch('/api/live?exchange=nse&file=live&t=' + bust).catch(() => null) : null,
      needBse ? fetch('/api/live?exchange=bse&file=live&t=' + bust).catch(() => null) : null,
    ]);
    if (needNse && nseRes && nseRes.ok) {
      const d = await nseRes.json().catch(() => null);
      if (d && d.revenue) nse = Object.assign({}, d.revenue, { source: d.revenue.source || 'github' });
    }
    if (needBse && bseRes && bseRes.ok) {
      const d = await bseRes.json().catch(() => null);
      if (d && d.revenue) bse = Object.assign({}, d.revenue, { source: d.revenue.source || 'github' });
    }
  }

  // 3. Final fallback — latest completed day from historical dashboard JSON
  const needNse2 = !nse || !nse.has_data;
  const needBse2 = !bse || !bse.has_data;
  if (needNse2 || needBse2) {
    const [nseDash, bseDash] = await Promise.all([
      needNse2 ? fetch('./data/nse_dashboard_data.json').then(r => r.json()).catch(() => null) : null,
      needBse2 ? fetch('./data/bse_dashboard_data.json').then(r => r.json()).catch(() => null) : null,
    ]);
    function lastFromDash(data) {
      if (!data) return null;
      const daily = data.daily_all || data.daily;
      if (!daily || !daily.length) return null;
      const last = daily[daily.length - 1];
      return { total_revenue: last.total_rev, trade_date: last.date, has_data: true, source: 'historical' };
    }
    if (needNse2) nse = lastFromDash(nseDash);
    if (needBse2) bse = lastFromDash(bseDash);
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function formatDate(dateStr) {
    if (!dateStr) return '';
    let d;
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
    } else if (/^\d{2}\/\d{2}\/\d{2}$/.test(dateStr)) {
      const parts = dateStr.split('/');
      d = new Date('20' + parts[2] + '-' + parts[1] + '-' + parts[0] + 'T00:00:00');
    } else { return dateStr; }
    if (isNaN(d.getTime())) return dateStr;
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function chip(label, info) {
    if (!info) return '';
    const isLive = info.source !== 'historical';
    const liveTag = isLive ? '<span class="rev-banner-live">LIVE</span>' : '';
    return '<span class="rev-banner-chip">' +
      '<span class="rev-banner-label">' + label + '</span>' +
      liveTag +
      '<span class="rev-banner-value">₹ ' + Number(info.total_revenue).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' Cr</span>' +
      '<span class="rev-banner-date">' + formatDate(info.trade_date) + '</span>' +
      '</span>';
  }

  const hasLive = (nse && nse.source !== 'historical') || (bse && bse.source !== 'historical');
  const title = hasLive ? "Today's Revenue" : 'Latest Full Day Revenue';
  el.innerHTML = '<span class="rev-banner-title">' + title + '</span>' + chip('NSE', nse) + chip('BSE', bse);
}

// ========================
// REBUILD ALL
// ========================

function rebuildAll() {
  applyChartDefaults();
  // Shared
  buildRevenueSummary();

  if (currentExchange === 'nse') {
    buildNSEExtrapolationKPIs();
    buildNSEPredictedPnLTable();
    initNSEPATPredictor();
    initNSEPEValuation();
    initNSEPrediction();
  } else if (currentExchange === 'bse') {
    buildBSERevenuePredictor();
    buildBSEShareAnalysis();
  } else if (currentExchange === 'mcx') {
    buildMCXRevenuePredictor();
    buildMCXShareAnalysis();
  }
}

// ========================
// REVENUE SUMMARY — SHARED
// ========================

function getRevFieldObj(segKey) {
  // Returns field names for quarterly and monthly data
  if (segKey === 'total') return { qField: 'total_rev', mField: 'total_rev', dField: 'total_rev' };
  if (segKey === 'options') return { qField: 'opt_rev', mField: 'opt_rev', dField: 'opt_rev' };
  if (segKey === 'futures') return { qField: 'fut_rev', mField: 'fut_rev', dField: 'fut_rev' };
  if (segKey === 'cash') return { qField: 'cash_rev', mField: 'cash_rev', dField: 'cash_rev' };
  return { qField: 'total_rev', mField: 'total_rev', dField: 'total_rev' };
}

function getYoYQuarter(qLabel) {
  const m = qLabel.match(/^(Q\d) FY (\d{4})$/);
  if (!m) return null;
  return m[1] + ' FY ' + (parseInt(m[2]) - 1);
}

function computeQuarterMetrics(qIdx, segKey) {
  const rf = getRevFieldObj(segKey);
  const allQ = DATA.quarterly;
  const sel = allQ[qIdx];
  const days = sel.days || sel.trading_days || 1;
  const selAvg = sel[rf.qField] / days;
  const prev = qIdx > 0 ? allQ[qIdx - 1] : null;
  const prevDays = prev ? (prev.days || prev.trading_days || 1) : 1;
  const prevAvg = prev ? prev[rf.qField] / prevDays : null;
  const qoq = prevAvg ? (selAvg - prevAvg) / prevAvg : null;

  const yoyLabel = getYoYQuarter(sel.quarter);
  const yoyQ = yoyLabel ? allQ.find(q => q.quarter === yoyLabel) : null;
  const yoyDays = yoyQ ? (yoyQ.days || yoyQ.trading_days || 1) : 1;
  const yoyAvg = yoyQ ? yoyQ[rf.qField] / yoyDays : null;
  const yoy = yoyAvg ? (selAvg - yoyAvg) / yoyAvg : null;

  return {
    label: sel.quarter,
    value: selAvg,
    prevLabel: prev ? prev.quarter : '—',
    prevValue: prevAvg,
    qoq: qoq,
    yoyLabel: yoyLabel || '—',
    yoyValue: yoyAvg,
    yoy: yoy
  };
}

function computeMonthMetrics(mIdx, segKey) {
  const rf = getRevFieldObj(segKey);
  const allM = DATA.monthly;
  const sel = allM[mIdx];
  const days = sel.trading_days || sel.days || 1;
  const selAvg = sel[rf.mField] / days;
  const prev = mIdx > 0 ? allM[mIdx - 1] : null;
  const prevDays = prev ? (prev.trading_days || prev.days || 1) : 1;
  const prevAvg = prev ? prev[rf.mField] / prevDays : null;
  const mom = prevAvg ? (selAvg - prevAvg) / prevAvg : null;

  let sumAvg = 0, cnt = 0;
  for (let i = Math.max(0, mIdx - 5); i <= mIdx; i++) {
    const mDays = allM[i].trading_days || allM[i].days || 1;
    sumAvg += allM[i][rf.mField] / mDays;
    cnt++;
  }
  const avg6m = cnt > 0 ? sumAvg / cnt : null;
  const mo6m = avg6m ? (selAvg - avg6m) / avg6m : null;

  return {
    label: sel.month,
    value: selAvg,
    prevLabel: prev ? prev.month : '—',
    prevValue: prevAvg,
    mom: mom,
    avg6mValue: avg6m,
    mo6m: mo6m
  };
}

// ── Excel-style Revenue Summary ──────────────────────────────────────────────

function xlChg(val) {
  if (val == null || isNaN(val)) return '<span class="xl-chg xl-neu">—</span>';
  const abs = Math.abs(val * 100).toFixed(1);
  const sign = val > 0.0005 ? '+' : val < -0.0005 ? '−' : '';
  const cls  = val > 0.0005 ? 'xl-pos' : val < -0.0005 ? 'xl-neg' : 'xl-neu';
  return `<span class="xl-chg ${cls}">${sign}${abs} %</span>`;
}

function xlVal(v) {
  if (v == null || isNaN(v)) return '<span class="xl-num">—</span>';
  return `<span class="xl-num">${fmt(v)}</span>`;
}

// ── Simple avg getters (no derived comparisons) ───────────────────────────────
function getFYAvg(fyStr, segKey) {
  const rf = getRevFieldObj(segKey);
  const quarters = DATA.quarterly.filter(q => q.quarter.endsWith(fyStr));
  if (!quarters.length) return null;
  const rev  = quarters.reduce((s, q) => s + (q[rf.qField] || 0), 0);
  const days = quarters.reduce((s, q) => s + (q.days || q.trading_days || 1), 0);
  return { label: fyStr, value: rev / days };
}

function getQAvg(qIdx, segKey) {
  const rf = getRevFieldObj(segKey);
  const q  = DATA.quarterly[qIdx];
  if (!q) return null;
  const days = q.days || q.trading_days || 1;
  return { label: q.quarter, value: q[rf.qField] / days };
}

function getMAvg(mIdx, segKey) {
  const rf = getRevFieldObj(segKey);
  const m  = DATA.monthly[mIdx];
  if (!m) return null;
  const days = m.trading_days || m.days || 1;
  return { label: m.month, value: m[rf.mField] / days };
}

function getM6mAvg(mIdx, segKey) {
  const rf   = getRevFieldObj(segKey);
  const allM = DATA.monthly;
  let sum = 0, cnt = 0;
  for (let i = Math.max(0, mIdx - 5); i <= mIdx; i++) {
    const d = allM[i].trading_days || allM[i].days || 1;
    sum += allM[i][rf.mField] / d;
    cnt++;
  }
  return cnt > 0 ? sum / cnt : null;
}

// ── Per-row render functions ──────────────────────────────────────────────────
// % change shown on each comparison row = (row0 - rowN) / rowN
// i.e. "current period is X% vs this row"

function renderFYRow(rowNum, fyStr, segKey) {
  const cur   = getFYAvg(fyStr, segKey);
  const valEl = document.getElementById('xlFYVal' + rowNum + '-' + segKey);
  const chgEl = document.getElementById('xlFYChg' + rowNum + '-' + segKey);
  if (valEl) valEl.innerHTML = xlVal(cur?.value);
  if (chgEl) {
    if (rowNum === 0) { chgEl.innerHTML = ''; return; }
    const ref = getFYAvg(document.getElementById('xlFY0-' + segKey)?.value, segKey);
    chgEl.innerHTML = xlChg(ref && cur ? (ref.value - cur.value) / cur.value : null);
  }
}

function renderQRow(rowNum, qIdx, segKey) {
  const cur   = getQAvg(qIdx, segKey);
  const valEl = document.getElementById('xlQVal' + rowNum + '-' + segKey);
  const chgEl = document.getElementById('xlQChg' + rowNum + '-' + segKey);
  if (valEl) valEl.innerHTML = xlVal(cur?.value);
  if (chgEl) {
    if (rowNum === 0) { chgEl.innerHTML = ''; return; }
    const ref = getQAvg(parseInt(document.getElementById('xlQ0-' + segKey)?.value), segKey);
    chgEl.innerHTML = xlChg(ref && cur ? (ref.value - cur.value) / cur.value : null);
  }
}

function renderMRow(rowNum, mIdx, segKey) {
  const cur   = getMAvg(mIdx, segKey);
  const valEl = document.getElementById('xlMVal' + rowNum + '-' + segKey);
  const chgEl = document.getElementById('xlMChg' + rowNum + '-' + segKey);
  if (valEl) valEl.innerHTML = xlVal(cur?.value);
  if (chgEl) {
    if (rowNum === 0) {
      chgEl.innerHTML = '';
      // Recompute Avg 6M (always anchored to row 0's month)
      const avg = getM6mAvg(mIdx, segKey);
      const avgValEl = document.getElementById('xlMAvgVal-' + segKey);
      const avgChgEl = document.getElementById('xlMAvgChg-' + segKey);
      if (avgValEl) avgValEl.innerHTML = xlVal(avg);
      if (avgChgEl) avgChgEl.innerHTML = xlChg(avg && cur ? (cur.value - avg) / avg : null);
      return;
    }
    const ref = getMAvg(parseInt(document.getElementById('xlM0-' + segKey)?.value), segKey);
    chgEl.innerHTML = xlChg(ref && cur ? (ref.value - cur.value) / cur.value : null);
  }
}

// ── Cross-segment sync functions ──────────────────────────────────────────────
const XL_SEGS = ['total', 'options', 'futures', 'cash'];

function syncXLFY(rowNum, fyStr) {
  XL_SEGS.forEach(sk => {
    const sel = document.getElementById('xlFY' + rowNum + '-' + sk);
    if (sel && sel.value !== fyStr) sel.value = fyStr;
    renderFYRow(rowNum, fyStr, sk);
    if (rowNum === 0) renderFYRow(1, document.getElementById('xlFY1-' + sk)?.value, sk);
  });
}

function syncXLQ(rowNum, qIdx) {
  XL_SEGS.forEach(sk => {
    const sel = document.getElementById('xlQ' + rowNum + '-' + sk);
    if (sel && parseInt(sel.value) !== qIdx) sel.value = qIdx;
    renderQRow(rowNum, qIdx, sk);
    if (rowNum === 0) {
      [1, 2, 3].forEach(r => {
        const ri = parseInt(document.getElementById('xlQ' + r + '-' + sk)?.value);
        if (!isNaN(ri)) renderQRow(r, ri, sk);
      });
    }
  });
}

function syncXLM(rowNum, mIdx) {
  XL_SEGS.forEach(sk => {
    const sel = document.getElementById('xlM' + rowNum + '-' + sk);
    if (sel && parseInt(sel.value) !== mIdx) sel.value = mIdx;
    renderMRow(rowNum, mIdx, sk);
    if (rowNum === 0) {
      const r1 = parseInt(document.getElementById('xlM1-' + sk)?.value);
      if (!isNaN(r1)) renderMRow(1, r1, sk);
    }
  });
}

// ── Segment block template ────────────────────────────────────────────────────
function xlSegmentBlock(segData, label, segKey, fyOpts, qOpts, mOpts) {
  const s   = segData;
  const wl5 = s.weekly.last5;
  const wp5 = s.weekly.prev5;
  const w50 = s.weekly.last45;
  const dow = s.day_of_week;
  const pw  = s.previous_week || {};
  const dayFull = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  const wRows = [
    `<tr class="xl-r-cur"><td>Last 5 Days</td><td>${xlVal(wl5.value)}</td><td>${xlChg(wl5.wow)}</td><td><span class="xl-tag">Wo10W ${xlChg(wl5.wo10w)}</span></td></tr>`,
    `<tr><td>Prev 5 Days</td><td>${xlVal(wp5.value)}</td><td></td><td></td></tr>`,
    `<tr><td>Last 45 Days</td><td>${xlVal(w50.value)}</td><td></td><td></td></tr>`,
  ].join('');

  const dowRows = dayFull.map((d) => {
    const dd = dow[d] || {};
    const pwVal = pw[d];
    return `<tr>
      <td class="xl-day">${d}</td>
      <td>${xlVal(dd.latest)}</td>
      <td>${xlVal(dd.avg_3d)}</td>
      <td>${xlChg(dd.do3d)}</td>
      <td>${xlVal(dd.avg_10d)}</td>
      <td>${xlChg(dd.do10d)}</td>
      <td class="xl-prev-wk">${pwVal != null ? xlVal(pwVal) : '<span class="xl-num">—</span>'}</td>
    </tr>`;
  }).join('');

  const mkSel = (id, opts) => `<select class="xl-row-sel" id="${id}">${opts}</select>`;

  // FY: 2 independently selectable rows
  const fyRows = [0, 1].map(r => `
    <tr${r === 0 ? ' class="xl-r-cur"' : ''}>
      <td>${mkSel('xlFY' + r + '-' + segKey, fyOpts)}</td>
      <td id="xlFYVal${r}-${segKey}"></td>
      <td id="xlFYChg${r}-${segKey}"></td>
      <td></td>
    </tr>`).join('');

  // Quarter: 4 independently selectable rows (current, prev1, prev2, same-Q last year)
  const qRows = [0, 1, 2, 3].map(r => `
    <tr${r === 0 ? ' class="xl-r-cur"' : ''}>
      <td>${mkSel('xlQ' + r + '-' + segKey, qOpts)}</td>
      <td id="xlQVal${r}-${segKey}"></td>
      <td id="xlQChg${r}-${segKey}"></td>
      <td></td>
    </tr>`).join('');

  // Month: 2 selectable rows + 1 static Avg 6M row
  const mRows = [0, 1].map(r => `
    <tr${r === 0 ? ' class="xl-r-cur"' : ''}>
      <td>${mkSel('xlM' + r + '-' + segKey, mOpts)}</td>
      <td id="xlMVal${r}-${segKey}"></td>
      <td id="xlMChg${r}-${segKey}"></td>
      <td></td>
    </tr>`).join('') + `
    <tr>
      <td style="color:var(--color-text-secondary);font-size:11.5px">Avg 6 Months</td>
      <td id="xlMAvgVal-${segKey}"></td>
      <td id="xlMAvgChg-${segKey}"></td>
      <td></td>
    </tr>`;

  return `
    <div class="xl-segment">
      <div class="xl-seg-header">${label} <span class="xl-seg-unit">₹ Cr · daily avg</span></div>
      <div class="xl-main-row">

        <table class="xl-period-table">
          <colgroup>
            <col class="xl-col-period">
            <col class="xl-col-val">
            <col class="xl-col-chg1">
            <col class="xl-col-chg2">
          </colgroup>

          <tbody class="xl-sec">
            <tr class="xl-sec-hdr"><td colspan="4">Financial Year</td></tr>
            <tr class="xl-col-hdr"><td>Year</td><td>Value</td><td>% chg</td><td></td></tr>
            ${fyRows}
          </tbody>

          <tbody class="xl-sec">
            <tr class="xl-sec-hdr"><td colspan="4">Quarter</td></tr>
            <tr class="xl-col-hdr"><td>Quarter</td><td>Value</td><td>% chg</td><td></td></tr>
            ${qRows}
          </tbody>

          <tbody class="xl-sec">
            <tr class="xl-sec-hdr"><td colspan="4">Month</td></tr>
            <tr class="xl-col-hdr"><td>Month</td><td>Value</td><td>% chg</td><td></td></tr>
            ${mRows}
          </tbody>

          <tbody class="xl-sec">
            <tr class="xl-sec-hdr"><td colspan="4">Week</td></tr>
            <tr class="xl-col-hdr"><td>Period</td><td>Value</td><td>WoW</td><td>Wo10W</td></tr>
            ${wRows}
          </tbody>
        </table>

        <table class="xl-dow-table">
          <thead>
            <tr class="xl-sec-hdr"><td colspan="7">Day of Week</td></tr>
            <tr class="xl-col-hdr"><td>Day</td><td>Latest</td><td>3D Avg</td><td>Do3D</td><td>10D Avg</td><td>Do10D</td><td>Prev Wk</td></tr>
          </thead>
          <tbody>${dowRows}</tbody>
        </table>

      </div>
    </div>`;
}

function buildRevenueSummary() {
  const ed = ENRICHED_DATA;
  if (!ed || !ed.summary_total) return;

  // Build option lists (no pre-selected — set via JS after render)
  const fySet = [];
  DATA.quarterly.forEach(q => {
    const m = q.quarter.match(/FY \d{4}/);
    if (m && !fySet.includes(m[0])) fySet.push(m[0]);
  });
  fySet.reverse(); // newest first
  const fyOpts = fySet.map(fy => `<option value="${fy}">${fy}</option>`).join('');

  const allQ  = DATA.quarterly;
  const nQ    = allQ.length;
  const qOpts = [...allQ].reverse().map((q, ri) => {
    const idx = nQ - 1 - ri;
    return `<option value="${idx}">${q.quarter}</option>`;
  }).join('');

  const allM  = DATA.monthly;
  const nM    = allM.length;
  const mOpts = [...allM].reverse().map((m, ri) => {
    const idx = nM - 1 - ri;
    return `<option value="${idx}">${m.month}</option>`;
  }).join('');

  // Render each segment into its own sub-tab container
  [
    { key: 'total',   data: ed.summary_total, label: 'Total Revenue' },
    { key: 'options', data: ed.seg_options,   label: 'Options Revenue' },
    { key: 'futures', data: ed.seg_futures,   label: 'Futures Revenue' },
    { key: 'cash',    data: ed.seg_cash,      label: 'Cash Revenue' },
  ].forEach(({ key, data, label }) => {
    const el = document.getElementById('subtab-rev-' + key);
    if (el) el.innerHTML = xlSegmentBlock(data, label, key, fyOpts, qOpts, mOpts);
  });

  // Default row values
  const defFY0 = fySet[0] || 'FY 2027';
  const defFY1 = fySet[1] || 'FY 2026';
  const defQ0  = nQ - 1;
  const defQ1  = Math.max(0, nQ - 2);
  const defQ2  = Math.max(0, nQ - 3);
  // Same Q number as current, one year earlier
  const curQNum = (allQ[defQ0]?.quarter || '').match(/^Q(\d)/)?.[1];
  let defQ3 = Math.max(0, nQ - 5);
  if (curQNum) {
    for (let i = defQ0 - 1; i >= 0; i--) {
      if (allQ[i].quarter.startsWith('Q' + curQNum + ' ')) { defQ3 = i; break; }
    }
  }
  const defM0 = nM - 1;
  const defM1 = Math.max(0, nM - 2);

  // Set select values then render data
  XL_SEGS.forEach(sk => {
    document.getElementById('xlFY0-' + sk).value = defFY0;
    document.getElementById('xlFY1-' + sk).value = defFY1;
    document.getElementById('xlQ0-'  + sk).value = defQ0;
    document.getElementById('xlQ1-'  + sk).value = defQ1;
    document.getElementById('xlQ2-'  + sk).value = defQ2;
    document.getElementById('xlQ3-'  + sk).value = defQ3;
    document.getElementById('xlM0-'  + sk).value = defM0;
    document.getElementById('xlM1-'  + sk).value = defM1;

    renderFYRow(0, defFY0, sk); renderFYRow(1, defFY1, sk);
    [defQ0, defQ1, defQ2, defQ3].forEach((qi, r) => renderQRow(r, qi, sk));
    renderMRow(0, defM0, sk); renderMRow(1, defM1, sk);

    // Wire event listeners
    [0, 1].forEach(r => {
      document.getElementById('xlFY' + r + '-' + sk).addEventListener('change', function() {
        syncXLFY(r, this.value);
      });
    });
    [0, 1, 2, 3].forEach(r => {
      document.getElementById('xlQ' + r + '-' + sk).addEventListener('change', function() {
        syncXLQ(r, parseInt(this.value));
      });
    });
    [0, 1].forEach(r => {
      document.getElementById('xlM' + r + '-' + sk).addEventListener('change', function() {
        syncXLM(r, parseInt(this.value));
      });
    });
  });
}




// ========================
// NSE: TEMPORAL ANALYSIS
// ========================

function buildNSETemporalCharts() {
  // Day-of-week
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const dowData = days.map(d => (DATA.dow_avg || {})[d] || { avg_total: 0, avg_options: 0, avg_futures: 0, avg_cash: 0 });

  setCanvasHeight('chartDOW', 280);
  charts.dow = new Chart(document.getElementById('chartDOW'), {
    type: 'bar',
    data: {
      labels: days,
      datasets: [
        { label: 'Options', data: dowData.map(x => x.avg_options), backgroundColor: CHART_COLORS[0], stack: 's', borderRadius: 2 },
        { label: 'Futures', data: dowData.map(x => x.avg_futures), backgroundColor: CHART_COLORS[1], stack: 's', borderRadius: 2 },
        { label: 'Cash', data: dowData.map(x => x.avg_cash), backgroundColor: CHART_COLORS[3], stack: 's', borderRadius: 2 },
      ]
    },
    options: {
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw),
            footer: items => 'Total Avg: ' + fmt(items.reduce((s, i) => s + i.raw, 0))
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });

  // Monthly revenue
  const m = DATA.monthly;
  setCanvasHeight('chartMonthlyRev', 280);
  charts.monthlyRev = new Chart(document.getElementById('chartMonthlyRev'), {
    type: 'line',
    data: {
      labels: m.map(x => x.month),
      datasets: [{
        label: 'Monthly Revenue',
        data: m.map(x => x.total_rev),
        borderColor: CHART_COLORS[0],
        backgroundColor: CHART_COLORS[0] + '15',
        fill: true,
        pointRadius: 2,
      }]
    },
    options: {
      scales: {
        x: { ticks: { maxTicksLimit: 18, maxRotation: 45, font: { size: 9 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });

  // Daily with 10-day MA
  const d = DATA.daily;
  const dailyLabels = d.map(x => {
    const dt = new Date(x.date);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  });
  const dailyRev = d.map(x => x.total_rev);
  const ma10 = dailyRev.map((_, i) => {
    if (i < 9) return null;
    let sum = 0;
    for (let j = i - 9; j <= i; j++) sum += dailyRev[j];
    return sum / 10;
  });

  setCanvasHeight('chartDailyMA', 280);
  charts.dailyMA = new Chart(document.getElementById('chartDailyMA'), {
    type: 'line',
    data: {
      labels: dailyLabels,
      datasets: [
        { label: 'Daily Revenue', data: dailyRev, borderColor: CHART_COLORS[0] + '60', borderWidth: 1, pointRadius: 1 },
        { label: '10-day MA', data: ma10, borderColor: CHART_COLORS[5], borderWidth: 2.5 },
      ]
    },
    options: {
      scales: {
        x: { ticks: { maxTicksLimit: 15, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) } }
      }
    }
  });

  // Quarterly table
  buildNSEQuarterlyTable();
}

// ========================
// NSE: QUARTER COMPARISON
// ========================

function initNSEQuarterCompare() {
  const quarters = [...new Set(DATA.daily.map(d => d.fy_quarter))];
  const sel1 = document.getElementById('qtrSelect1');
  const sel2 = document.getElementById('qtrSelect2');
  sel1.innerHTML = '';
  sel2.innerHTML = '<option value="">None</option>';

  const reversedQ = [...quarters].reverse();
  reversedQ.forEach(q => {
    sel1.innerHTML += `<option value="${q}">${q}</option>`;
    sel2.innerHTML += `<option value="${q}">${q}</option>`;
  });
  sel1.value = reversedQ[0];

  function renderQtrCompare() {
    if (charts.qtrCompare) charts.qtrCompare.destroy();
    const q1 = sel1.value;
    const q2 = sel2.value;
    if (!q1) return;

    const q1Data = DATA.daily.filter(d => d.fy_quarter === q1);
    const maxDays = q1Data.length;
    const labels = q1Data.map((_, i) => 'Day ' + (i + 1));
    const datasets = [{
      label: q1,
      data: q1Data.map(d => d.total_rev),
      borderColor: CHART_COLORS[0],
      backgroundColor: CHART_COLORS[0] + '15',
      fill: true, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
    }];

    if (q2) {
      const q2Data = DATA.daily.filter(d => d.fy_quarter === q2);
      if (q2Data.length > maxDays) {
        for (let i = maxDays; i < q2Data.length; i++) labels.push('Day ' + (i + 1));
      }
      datasets.push({
        label: q2,
        data: q2Data.map(d => d.total_rev),
        borderColor: CHART_COLORS[1],
        backgroundColor: CHART_COLORS[1] + '15',
        fill: true, borderWidth: 2, borderDash: [5, 3], pointRadius: 2, pointHoverRadius: 5,
      });
    }

    charts.qtrCompare = new Chart(document.getElementById('chartQtrCompare'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              title: items => items[0].label,
              label: ctx => {
                const qData = ctx.dataset.label === q1
                  ? DATA.daily.filter(d => d.fy_quarter === q1)
                  : DATA.daily.filter(d => d.fy_quarter === q2);
                const actualDate = qData[ctx.dataIndex] ? qData[ctx.dataIndex].date : '';
                return ctx.dataset.label + ': ' + fmt(ctx.raw) + (actualDate ? ' (' + actualDate + ')' : '');
              }
            }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 20, font: { size: 10 } } },
          y: { ticks: { callback: v => '\u20b9' + fmtNum(v, 0) + ' Cr' } }
        }
      }
    });
  }

  sel1.addEventListener('change', renderQtrCompare);
  sel2.addEventListener('change', renderQtrCompare);
  renderQtrCompare();
}

// ========================
// NSE: PAT PREDICTION ENGINE
// ========================

function buildNSEExtrapolationKPIs() {
  const p = ENRICHED_DATA.pnl_predictor;
  if (!p) return;
  const otherIncome = p.total_revenue_predicted - p.transaction_rev_extrapolated;

  const kpis = [
    { label: 'Daily Avg Txn Rev', value: fmt(p.daily_avg_rev) },
    { label: 'Trading Days (Actual / Expected)', value: `${p.q4_fy2026_trading_days_so_far || p.trading_days_so_far} / ${p.q4_fy2025_total_trading_days || p.expected_trading_days}` },
    { label: 'Extrapolated Qtr Txn Rev', value: fmt(p.transaction_rev_extrapolated) },
    { label: `Other Income (${fmtPct(p.other_income_ratio)} of Txn Rev)`, value: fmt(otherIncome) },
    { label: 'Total Revenue (Predicted)', value: fmt(p.total_revenue_predicted), highlight: true },
    { label: 'Predicted PAT', value: fmt(p.pat_predicted), highlight: true },
  ];

  document.getElementById('extrapKpis').innerHTML = kpis.map(k => `
    <div class="extrap-card${k.highlight ? ' highlight' : ''}">
      <div class="extrap-label">${k.label}</div>
      <div class="extrap-value">${k.value}</div>
    </div>
  `).join('');
}

function buildNSEPredictedPnLTable() {
  const quarters = ENRICHED_DATA.pnl_predicted_quarters;
  if (!quarters) return;
  let html = '<thead><tr><th>Quarter</th><th>Txn Rev</th><th>Other Income</th><th>Total Rev</th><th>Total Exp</th><th>EBITDA</th><th>EBITDA %</th><th>PAT</th><th>PAT %</th><th>EPS</th></tr></thead><tbody>';

  let isFirst = true;
  for (const [qName, q] of Object.entries(quarters)) {
    const otherIncome = q.total_revenue - q.transaction_rev;
    const tag = isFirst ? ' <span style="color:var(--color-warning);font-size:10px;font-weight:600">CURRENT</span>' : '';
    const cls = isFirst ? '' : 'predicted';
    html += `<tr class="${cls}">
      <td>${qName}${tag}</td>
      <td>${fmt(q.transaction_rev)}</td>
      <td>${fmt(otherIncome)}</td>
      <td>${fmt(q.total_revenue)}</td>
      <td>${fmt(q.total_expense)}</td>
      <td>${fmt(q.ebitda)}</td>
      <td>${fmtPct(q.ebitda_margin)}</td>
      <td style="font-weight:600">${fmt(q.pat)}</td>
      <td>${fmtPct(q.pat_margin)}</td>
      <td>₹ ${fmtNum(q.eps)}</td>
    </tr>`;
    isFirst = false;
  }
  html += '</tbody>';
  document.getElementById('tablePredictedPnL').innerHTML = html;
}

function initNSEPATPredictor() {
  const p = ENRICHED_DATA.pnl_predictor;
  if (!p || !DATA.cost_ratios) return;
  const lastCostQ = Object.keys(DATA.cost_ratios).pop();
  const cr = DATA.cost_ratios[lastCostQ];

  const dailyRevInput = document.getElementById('inputDailyRev');
  const tradingDaysInput = document.getElementById('inputTradingDays');
  const otherIncomeInput = document.getElementById('inputOtherIncomeRatio');
  const taxInput = document.getElementById('inputTaxRate');
  const sharesInput = document.getElementById('inputShares');

  dailyRevInput.value = p.daily_avg_rev.toFixed(1);
  otherIncomeInput.value = (p.other_income_ratio * 100).toFixed(1);

  document.getElementById('predictorHint').textContent =
    'Current Q4 FY 2026 avg: ₹ ' + p.daily_avg_rev.toFixed(2) + ' Cr/day';

  const costParams = {
    emp_pct: cr.employee_pct || 0.044,
    reg_pct: cr.regulatory_pct || 0.045,
    tech_pct: cr.technology_pct || 0.07,
    dep_pct: cr.depreciation_pct || 0.035,
    csr_other_pct: 0.035,
  };

  function computePredictor() {
    const dailyRev = Number(dailyRevInput.value) || 0;
    const tradingDays = Number(tradingDaysInput.value) || 62;
    const otherIncomeRatio = (Number(otherIncomeInput.value) || 0) / 100;
    const taxRate = (Number(taxInput.value) || 25.2) / 100;
    const shares = Number(sharesInput.value) || 247.5;

    if (dailyRev <= 0) {
      document.getElementById('predictorOutput').innerHTML = '';
      document.getElementById('predictorPEResults').innerHTML = '';
      return;
    }

    const qtrTxnRev = dailyRev * tradingDays;
    const otherIncome = qtrTxnRev * otherIncomeRatio;
    const totalRev = qtrTxnRev + otherIncome;

    const empCost = totalRev * costParams.emp_pct;
    const regCost = totalRev * costParams.reg_pct;
    const techCost = totalRev * costParams.tech_pct;
    const depCost = totalRev * costParams.dep_pct;
    const csrOther = totalRev * costParams.csr_other_pct;
    const totalExp = empCost + regCost + techCost + depCost + csrOther;

    const pbt = totalRev - totalExp;
    const tax = pbt * taxRate;
    const pat = pbt - tax;

    const qtrEPS = pat / shares;
    const annualEPS = qtrEPS * 4;

    document.getElementById('predictorOutput').innerHTML = `
      <div class="pred-card">
        <div class="pred-label">Qtr Txn Revenue</div>
        <div class="pred-value">${fmt(qtrTxnRev)}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:4px">${fmt(dailyRev)}/day × ${tradingDays} days</div>
      </div>
      <div class="pred-card">
        <div class="pred-label">Other Income</div>
        <div class="pred-value">${fmt(otherIncome)}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:4px">${(otherIncomeRatio * 100).toFixed(1)}% of Txn Rev</div>
      </div>
      <div class="pred-card">
        <div class="pred-label">Total Revenue</div>
        <div class="pred-value">${fmt(totalRev)}</div>
      </div>
      <div class="pred-card">
        <div class="pred-label">Total Expenses</div>
        <div class="pred-value">${fmt(totalExp)}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:4px">${fmtPct(totalExp / totalRev)} of revenue</div>
      </div>
      <div class="pred-card highlight">
        <div class="pred-label">Quarterly PAT</div>
        <div class="pred-value" style="color:var(--color-success)">${fmt(pat)}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:4px">${fmtPct(pat / totalRev)} margin</div>
      </div>
      <div class="pred-card">
        <div class="pred-label">EPS (Quarterly)</div>
        <div class="pred-value">₹ ${qtrEPS.toFixed(2)}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:4px">Annualized: ₹ ${annualEPS.toFixed(2)}</div>
      </div>
    `;

    updatePredictorPE(annualEPS);
  }

  function updatePredictorPE(annualEPS) {
    if (!annualEPS || annualEPS <= 0) {
      document.getElementById('predictorPEResults').innerHTML = '';
      return;
    }
    const bearPE = Number(document.getElementById('predBearPE').value) || 25;
    const basePE = Number(document.getElementById('predBasePE').value) || 35;
    const bullPE = Number(document.getElementById('predBullPE').value) || 45;

    document.getElementById('predictorPEResults').innerHTML = `
      <div class="pe-card bear">
        <div class="pe-scenario-label">Bear Case</div>
        <div class="pe-subtitle">${bearPE}x PE × ₹${annualEPS.toFixed(2)} EPS</div>
        <div class="pe-price">${fmtPrice(bearPE * annualEPS)}</div>
      </div>
      <div class="pe-card base">
        <div class="pe-scenario-label">Base Case</div>
        <div class="pe-subtitle">${basePE}x PE × ₹${annualEPS.toFixed(2)} EPS</div>
        <div class="pe-price">${fmtPrice(basePE * annualEPS)}</div>
      </div>
      <div class="pe-card bull">
        <div class="pe-scenario-label">Bull Case</div>
        <div class="pe-subtitle">${bullPE}x PE × ₹${annualEPS.toFixed(2)} EPS</div>
        <div class="pe-price">${fmtPrice(bullPE * annualEPS)}</div>
      </div>
    `;
  }

  [dailyRevInput, tradingDaysInput, otherIncomeInput, taxInput, sharesInput].forEach(el => {
    el.addEventListener('input', computePredictor);
  });
  ['predBearPE', 'predBasePE', 'predBullPE'].forEach(id => {
    document.getElementById(id).addEventListener('input', computePredictor);
  });
  computePredictor();
}

function initNSEPEValuation() {
  const bearInput = document.getElementById('peBear');
  const baseInput = document.getElementById('peBase');
  const bullInput = document.getElementById('peBull');

  function updatePEResults() {
    const quarters = ENRICHED_DATA.pnl_predicted_quarters;
    if (!quarters) return;
    const q4Data = quarters['Q4 FY 2026'];
    if (!q4Data || !q4Data.eps) return;

    const quarterlyEPS = q4Data.eps;
    const annualizedEPS = quarterlyEPS * 4;

    const bearPE = Number(bearInput.value) || 25;
    const basePE = Number(baseInput.value) || 35;
    const bullPE = Number(bullInput.value) || 45;

    document.getElementById('peResults').innerHTML = `
      <div class="pe-card bear">
        <div class="pe-scenario-label">Bear Case</div>
        <div class="pe-subtitle">${bearPE}x PE</div>
        <div class="pe-price">${fmtPrice(bearPE * annualizedEPS)}</div>
      </div>
      <div class="pe-card base">
        <div class="pe-scenario-label">Base Case</div>
        <div class="pe-subtitle">${basePE}x PE</div>
        <div class="pe-price">${fmtPrice(basePE * annualizedEPS)}</div>
      </div>
      <div class="pe-card bull">
        <div class="pe-scenario-label">Bull Case</div>
        <div class="pe-subtitle">${bullPE}x PE</div>
        <div class="pe-price">${fmtPrice(bullPE * annualizedEPS)}</div>
      </div>
    `;
  }

  bearInput.addEventListener('input', updatePEResults);
  baseInput.addEventListener('input', updatePEResults);
  bullInput.addEventListener('input', updatePEResults);
  updatePEResults();
}

let predState = {};

function initNSEPrediction() {
  if (!DATA.pnl || !DATA.cost_ratios) return;
  const actualPnl = DATA.pnl.filter(p => !p.is_predicted);
  const lastActual = actualPnl[actualPnl.length - 1];
  const lastQ = lastActual.quarter;
  const cr = DATA.cost_ratios[lastQ] || Object.values(DATA.cost_ratios)[Object.values(DATA.cost_ratios).length - 1];

  const cq = DATA.quarterly[DATA.quarterly.length - 1];
  const days = cq.days || 62;
  const annualFactor = 62 / Math.max(days, 1);

  predState = {
    optRev: Math.round(cq.opt_rev * annualFactor),
    futRev: Math.round(cq.fut_rev * annualFactor),
    cashRev: Math.round(cq.cash_rev * annualFactor),
    empPct: (cr.employee_pct * 100) || 4.0,
    regPct: (cr.regulatory_pct * 100) || 4.5,
    techPct: (cr.technology_pct * 100) || 7.0,
    depPct: (cr.depreciation_pct * 100) || 3.5,
    otherIncome: (cr.other_income_ratio * 100) || 45,
  };

  setSlider('sliderOpt', 'valOpt', predState.optRev, v => fmt(v));
  setSlider('sliderFut', 'valFut', predState.futRev, v => fmt(v));
  setSlider('sliderCash', 'valCash', predState.cashRev, v => fmt(v));
  setSlider('sliderEmp', 'valEmp', predState.empPct, v => v.toFixed(1) + '%');
  setSlider('sliderReg', 'valReg', predState.regPct, v => v.toFixed(1) + '%');
  setSlider('sliderTech', 'valTech', predState.techPct, v => v.toFixed(1) + '%');
  setSlider('sliderDep', 'valDep', predState.depPct, v => v.toFixed(1) + '%');
  setSlider('sliderOther', 'valOther', predState.otherIncome, v => v.toFixed(0) + '%');

  const sliders = ['sliderOpt', 'sliderFut', 'sliderCash', 'sliderEmp', 'sliderReg', 'sliderTech', 'sliderDep', 'sliderOther'];
  sliders.forEach(id => {
    document.getElementById(id).addEventListener('input', () => updateNSEPrediction());
  });

  document.querySelectorAll('.scenario-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyNSEScenario(btn.dataset.scenario);
    });
  });

  updateNSEPrediction();
  buildNSEPnLTable();
  buildNSEPATHistoryChart();
}

function setSlider(sliderId, valId, value, formatter) {
  const sl = document.getElementById(sliderId);
  const vl = document.getElementById(valId);
  if (!sl || !vl) return;
  sl.value = value;
  vl.textContent = formatter(value);
  sl.addEventListener('input', () => {
    vl.textContent = formatter(Number(sl.value));
  });
}

function applyNSEScenario(scenario) {
  const cq = DATA.quarterly[DATA.quarterly.length - 1];
  const days = cq.days || 62;
  const annualFactor = 62 / Math.max(days, 1);
  let factor = 1;
  if (scenario === 'bear') factor = 0.85;
  if (scenario === 'bull') factor = 1.15;

  document.getElementById('sliderOpt').value = Math.round(cq.opt_rev * annualFactor * factor);
  document.getElementById('sliderFut').value = Math.round(cq.fut_rev * annualFactor * factor);
  document.getElementById('sliderCash').value = Math.round(cq.cash_rev * annualFactor * factor);

  document.getElementById('valOpt').textContent = fmt(Number(document.getElementById('sliderOpt').value));
  document.getElementById('valFut').textContent = fmt(Number(document.getElementById('sliderFut').value));
  document.getElementById('valCash').textContent = fmt(Number(document.getElementById('sliderCash').value));

  updateNSEPrediction();
}

function updateNSEPrediction() {
  const optRev = Number(document.getElementById('sliderOpt').value);
  const futRev = Number(document.getElementById('sliderFut').value);
  const cashRev = Number(document.getElementById('sliderCash').value);
  const empPct = Number(document.getElementById('sliderEmp').value) / 100;
  const regPct = Number(document.getElementById('sliderReg').value) / 100;
  const techPct = Number(document.getElementById('sliderTech').value) / 100;
  const depPct = Number(document.getElementById('sliderDep').value) / 100;
  const otherIncome = Number(document.getElementById('sliderOther').value) / 100;

  const transactionRev = optRev + futRev + cashRev;
  const otherRev = transactionRev * otherIncome;
  const totalRev = transactionRev + otherRev;

  const empCost = totalRev * empPct;
  const regCost = totalRev * regPct;
  const techCost = totalRev * techPct;
  const depCost = totalRev * depPct;
  const csrOther = totalRev * 0.035;
  const totalExp = empCost + regCost + techCost + depCost + csrOther;

  const ebitda = totalRev - totalExp + depCost;
  const ebitdaMargin = ebitda / totalRev;
  const pbt = totalRev - totalExp;
  const tax = pbt * 0.252;
  const pat = pbt - tax;
  const patMargin = pat / totalRev;

  const container = document.getElementById('predResult');
  container.innerHTML = `
    <div class="pred-card">
      <div class="pred-label">Total Revenue</div>
      <div class="pred-value">${fmt(totalRev)}</div>
    </div>
    <div class="pred-card">
      <div class="pred-label">EBITDA</div>
      <div class="pred-value">${fmt(ebitda)}</div>
      <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:4px">${fmtPct(ebitdaMargin)} margin</div>
    </div>
    <div class="pred-card highlight">
      <div class="pred-label">Predicted PAT</div>
      <div class="pred-value" style="color:var(--color-primary-hover)">${fmt(pat)}</div>
      <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:4px">${fmtPct(patMargin)} margin</div>
    </div>
    <div class="pred-card">
      <div class="pred-label">EPS (est.)</div>
      <div class="pred-value">₹ ${(pat / 247.5).toFixed(2)}</div>
      <div style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:4px">~247.5 Cr shares</div>
    </div>
  `;

  buildNSEWaterfallChart(transactionRev, otherRev, totalRev, totalExp, empCost, regCost, techCost, depCost, csrOther, ebitda, pbt, tax, pat);
}

function buildNSEWaterfallChart(txnRev, otherRev, totalRev, totalExp, emp, reg, tech, dep, csrOther, ebitda, pbt, tax, pat) {
  if (charts.waterfall) charts.waterfall.destroy();
  setCanvasHeight('chartWaterfall', 300);

  const labels = ['Txn Rev', 'Other Income', 'Total Rev', 'Employee', 'Regulatory', 'Technology', 'Depreciation', 'Other Exp', 'PBT', 'Tax', 'PAT'];
  let running = 0;
  const floatingData = [];
  const colors = [];

  floatingData.push([0, txnRev]); colors.push(CHART_COLORS[0]);
  floatingData.push([txnRev, txnRev + otherRev]); colors.push(CHART_COLORS[3]);
  floatingData.push([0, totalRev]); colors.push(CHART_COLORS[0]);
  running = totalRev;
  floatingData.push([running - emp, running]); running -= emp; colors.push(CHART_COLORS[4]);
  floatingData.push([running - reg, running]); running -= reg; colors.push(CHART_COLORS[4]);
  floatingData.push([running - tech, running]); running -= tech; colors.push(CHART_COLORS[4]);
  floatingData.push([running - dep, running]); running -= dep; colors.push(CHART_COLORS[4]);
  floatingData.push([running - csrOther, running]); running -= csrOther; colors.push(CHART_COLORS[4]);
  floatingData.push([0, pbt]); colors.push(CHART_COLORS[5]);
  floatingData.push([pat, pbt]); colors.push(CHART_COLORS[1]);
  floatingData.push([0, pat]); colors.push('#30d158');

  charts.waterfall = new Chart(document.getElementById('chartWaterfall'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'P&L Waterfall',
        data: floatingData,
        backgroundColor: colors,
        borderRadius: 3,
        borderSkipped: false,
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const range = ctx.raw;
              const value = Math.abs(range[1] - range[0]);
              return ctx.label + ': ' + fmt(value);
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 9 } } },
        y: { beginAtZero: true, ticks: { callback: v => '₹' + fmtNum(v, 0) } }
      }
    }
  });
}

function buildNSEPATHistoryChart() {
  const p = DATA.pnl;
  if (!p || p.length === 0) return;
  setCanvasHeight('chartPATHistory', 300);

  const allLabels = p.map(x => {
    const parts = x.quarter.split(' ');
    return parts[0] + " '" + parts[2].slice(2);
  });
  const barColors = p.map(x => x.is_predicted ? CHART_COLORS[5] : CHART_COLORS[0]);
  const patValues = p.map(x => x.pat);

  if (charts.patHistory) charts.patHistory.destroy();
  charts.patHistory = new Chart(document.getElementById('chartPATHistory'), {
    type: 'bar',
    data: {
      labels: allLabels,
      datasets: [{
        label: 'PAT',
        data: patValues,
        backgroundColor: barColors,
        borderColor: barColors,
        borderWidth: 1,
        borderRadius: 3,
      }]
    },
    options: {
      plugins: {
        legend: {
          display: true,
          labels: {
            generateLabels: function() {
              return [
                { text: 'Actual PAT', fillStyle: CHART_COLORS[0], strokeStyle: CHART_COLORS[0], lineWidth: 0, hidden: false },
                { text: 'Predicted PAT', fillStyle: CHART_COLORS[5], strokeStyle: CHART_COLORS[5], lineWidth: 0, hidden: false },
              ];
            }
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const isPred = DATA.pnl[ctx.dataIndex].is_predicted;
              return (isPred ? 'Predicted: ' : 'Actual: ') + fmt(ctx.raw);
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });
}

function buildNSEPnLTable() {
  const p = DATA.pnl;
  if (!p) return;
  let html = '<thead><tr><th>Quarter</th><th>Txn Rev</th><th>Total Rev</th><th>Total Exp</th><th>EBITDA</th><th>EBITDA %</th><th>PAT</th><th>PAT %</th><th>EPS</th></tr></thead><tbody>';
  for (const q of p) {
    const cls = q.is_predicted ? 'predicted' : '';
    html += `<tr class="${cls}">
      <td>${q.quarter}</td>
      <td>${fmt(q.transaction_rev)}</td>
      <td>${fmt(q.total_revenue)}</td>
      <td>${fmt(q.total_expense)}</td>
      <td>${fmt(q.ebitda)}</td>
      <td>${fmtPct(q.ebitda_margin)}</td>
      <td style="font-weight:600">${fmt(q.pat)}</td>
      <td>${fmtPct(q.pat_margin)}</td>
      <td>₹ ${fmtNum(q.eps)}</td>
    </tr>`;
  }
  html += '</tbody>';
  document.getElementById('tablePnL').innerHTML = html;
}

// ========================
// NSE: ADVANCED ANALYTICS
// ========================

function buildNSEAdvancedCharts() {
  const d = DATA.daily;
  const hasVix = d.some(x => x.vix > 0);
  const labels = d.map(x => {
    const dt = new Date(x.date);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  });

  // PN ratio vs VIX
  setCanvasHeight('chartPNVix', 300);
  if (hasVix) {
    charts.pnVix = new Chart(document.getElementById('chartPNVix'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'P/N Ratio (bps)',
            data: d.map(x => x.pn_ratio * 10000),
            borderColor: CHART_COLORS[0],
            yAxisID: 'y1',
            borderWidth: 1.5,
            pointRadius: 1,
          },
          {
            label: 'India VIX',
            data: d.map(x => x.vix),
            borderColor: CHART_COLORS[5],
            yAxisID: 'y2',
            borderWidth: 2,
            borderDash: [4, 3],
            pointRadius: 0,
          },
        ]
      },
      options: {
        scales: {
          x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
          y1: { position: 'left', title: { display: true, text: 'P/N Ratio (bps)', color: CHART_COLORS[0], font: { size: 10 } } },
          y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'India VIX', color: CHART_COLORS[5], font: { size: 10 } } },
        }
      }
    });
  }

  // Scatter
  setCanvasHeight('chartScatter', 300);
  if (hasVix) {
    charts.scatter = new Chart(document.getElementById('chartScatter'), {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Daily Revenue vs VIX',
          data: d.map(x => ({ x: x.vix, y: x.total_rev })),
          backgroundColor: CHART_COLORS[0] + '80',
          pointRadius: 4,
          pointHoverRadius: 6,
        }]
      },
      options: {
        scales: {
          x: { title: { display: true, text: 'India VIX', font: { size: 10 } }, ticks: { font: { size: 10 } } },
          y: { title: { display: true, text: 'Total Revenue (₹ Cr)', font: { size: 10 } }, ticks: { callback: v => '₹' + fmtNum(v, 0) } },
        },
        plugins: {
          tooltip: { callbacks: { label: ctx => 'VIX: ' + fmtNum(ctx.raw.x, 1) + ', Rev: ' + fmt(ctx.raw.y) } }
        }
      }
    });
  }

  // Contracts vs Revenue
  setCanvasHeight('chartContracts', 300);
  charts.contracts = new Chart(document.getElementById('chartContracts'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Revenue',
          data: d.map(x => x.total_rev),
          borderColor: CHART_COLORS[0],
          yAxisID: 'y1',
          borderWidth: 1.5,
        },
        {
          label: 'Contracts (Mn)',
          data: d.map(x => x.total_contracts / 1e6),
          borderColor: CHART_COLORS[4],
          yAxisID: 'y2',
          borderWidth: 1.5,
          borderDash: [4, 3],
        },
      ]
    },
    options: {
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
        y1: { position: 'left', title: { display: true, text: 'Revenue (₹ Cr)', color: CHART_COLORS[0], font: { size: 10 } } },
        y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Contracts (Mn)', color: CHART_COLORS[4], font: { size: 10 } } },
      }
    }
  });

  buildHeatmap();
}

function buildHeatmap() {
  const q = DATA.quarterly;
  const fys = {};
  q.forEach(item => {
    const parts = item.quarter.split(' ');
    const qNum = parts[0];
    const fy = parts[1] + ' ' + parts[2];
    if (!fys[fy]) fys[fy] = {};
    fys[fy][qNum] = item;
  });

  const allVals = q.map(x => x.total_rev);
  const minRev = Math.min(...allVals);
  const maxRev = Math.max(...allVals);
  const rgb = getHeatmapRgb();

  let html = '<table class="data-table"><thead><tr><th>FY</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead><tbody>';
  Object.keys(fys).forEach(fy => {
    html += `<tr><td>${fy}</td>`;
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach(qn => {
      const item = fys[fy][qn];
      if (item) {
        const intensity = (item.total_rev - minRev) / (maxRev - minRev);
        const bg = `rgba(${rgb}, ${(0.1 + intensity * 0.5).toFixed(2)})`;
        html += `<td style="background:${bg};font-weight:600">${fmt(item.total_rev)}</td>`;
      } else {
        html += `<td style="color:var(--color-text-faint)">—</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('heatmapContainer').innerHTML = html;
}

// ========================
// BSE: REVENUE PREDICTOR
// ========================

function buildBSERevenuePredictor() {
  const p = ENRICHED_DATA.pnl_predictor;
  if (!p) return;
  const otherIncome = p.total_revenue_predicted - p.transaction_rev_extrapolated;
  const progressPct = ((p.trading_days_so_far / p.expected_trading_days) * 100).toFixed(0);

  const kpis = [
    { label: 'Daily Avg Transaction Rev', value: fmt(p.daily_avg_rev) },
    { label: 'Trading Days (Actual / Expected)', value: `${p.trading_days_so_far} / ${p.expected_trading_days}` },
    { label: 'Extrapolated Qtr Transaction Rev', value: fmt(p.transaction_rev_extrapolated) },
    { label: `Other Income (~${fmtPct(p.other_income_ratio)} of Txn)`, value: fmt(otherIncome) },
  ];

  document.getElementById('bsePredictorKpis').innerHTML = kpis.map(k => `
    <div class="extrap-card${k.highlight ? ' highlight' : ''}">
      <div class="extrap-label">${k.label}</div>
      <div class="extrap-value">${k.value}</div>
    </div>
  `).join('') + `
    <div class="extrap-card highlight" style="grid-column: 1 / -1">
      <div class="extrap-label">Total Estimated Quarterly Revenue</div>
      <div class="extrap-value" style="font-size:var(--text-xl)">${fmt(p.total_revenue_predicted)}</div>
    </div>
  `;

  document.getElementById('bseProgressBarFill').style.width = progressPct + '%';
  document.getElementById('bseProgressLabel').textContent =
    `Quarter Progress: ${p.trading_days_so_far} of ${p.expected_trading_days} trading days completed (${progressPct}%)`;

  // Composition table
  const q = DATA.quarterly;
  const cq = q[q.length - 1];
  const cqDays = cq.days || cq.trading_days || 1;
  const optPct = cq.total_rev > 0 ? (cq.opt_rev / cq.total_rev * 100).toFixed(1) : 0;
  const cashPct = cq.total_rev > 0 ? (cq.cash_rev / cq.total_rev * 100).toFixed(1) : 0;
  const futPct = cq.total_rev > 0 ? (cq.fut_rev / cq.total_rev * 100).toFixed(1) : 0;

  let compositionHTML = `<thead><tr><th>Segment</th><th>Current Qtr Rev</th><th>% of Total</th><th>Days</th><th>Daily Avg</th></tr></thead><tbody>`;
  compositionHTML += `<tr><td>Options</td><td>${fmt(cq.opt_rev)}</td><td>${optPct}%</td><td>${cqDays}</td><td>${fmt(cq.opt_rev / cqDays)}</td></tr>`;
  compositionHTML += `<tr><td>Futures</td><td>${fmt(cq.fut_rev)}</td><td>${futPct}%</td><td>${cqDays}</td><td>${fmt(cq.fut_rev / cqDays)}</td></tr>`;
  compositionHTML += `<tr><td>Cash</td><td>${fmt(cq.cash_rev)}</td><td>${cashPct}%</td><td>${cqDays}</td><td>${fmt(cq.cash_rev / cqDays)}</td></tr>`;
  compositionHTML += `<tr style="font-weight:600"><td>Total</td><td>${fmt(cq.total_rev)}</td><td>100%</td><td>${cqDays}</td><td>${fmt(cq.total_rev / cqDays)}</td></tr>`;
  compositionHTML += `</tbody>`;
  document.getElementById('tableBseRevComposition').innerHTML = compositionHTML;
}

function buildMCXRevenuePredictor() {
  const p = ENRICHED_DATA.pnl_predictor;
  if (!p) return;
  const otherIncome = p.total_revenue_predicted - p.transaction_rev_extrapolated;
  const progressPct = ((p.trading_days_so_far / p.expected_trading_days) * 100).toFixed(0);

  const kpis = [
    { label: 'Daily Avg Transaction Rev', value: fmt(p.daily_avg_rev) },
    { label: 'Trading Days (Actual / Expected)', value: `${p.trading_days_so_far} / ${p.expected_trading_days}` },
    { label: 'Extrapolated Qtr Transaction Rev', value: fmt(p.transaction_rev_extrapolated) },
    { label: `Other Income (~${fmtPct(p.other_income_ratio)} of Txn)`, value: fmt(otherIncome) },
  ];

  document.getElementById('mcxPredictorKpis').innerHTML = kpis.map(k => `
    <div class="extrap-card${k.highlight ? ' highlight' : ''}">
      <div class="extrap-label">${k.label}</div>
      <div class="extrap-value">${k.value}</div>
    </div>
  `).join('') + `
    <div class="extrap-card highlight" style="grid-column: 1 / -1">
      <div class="extrap-label">Total Estimated Quarterly Revenue</div>
      <div class="extrap-value" style="font-size:var(--text-xl)">${fmt(p.total_revenue_predicted)}</div>
    </div>
  `;

  document.getElementById('mcxProgressBarFill').style.width = progressPct + '%';
  document.getElementById('mcxProgressLabel').textContent =
    `Quarter Progress: ${p.trading_days_so_far} of ${p.expected_trading_days} trading days completed (${progressPct}%)`;

  const q = DATA.quarterly;
  const cq = q[q.length - 1];
  const cqDays = cq.days || cq.trading_days || 1;
  const optPct  = cq.total_rev > 0 ? (cq.opt_rev  / cq.total_rev * 100).toFixed(1) : 0;
  const cashPct = cq.total_rev > 0 ? (cq.cash_rev / cq.total_rev * 100).toFixed(1) : 0;
  const futPct  = cq.total_rev > 0 ? (cq.fut_rev  / cq.total_rev * 100).toFixed(1) : 0;

  let compositionHTML = `<thead><tr><th>Segment</th><th>Current Qtr Rev</th><th>% of Total</th><th>Days</th><th>Daily Avg</th></tr></thead><tbody>`;
  compositionHTML += `<tr><td>Options</td><td>${fmt(cq.opt_rev)}</td><td>${optPct}%</td><td>${cqDays}</td><td>${fmt(cq.opt_rev / cqDays)}</td></tr>`;
  compositionHTML += `<tr><td>Futures</td><td>${fmt(cq.fut_rev)}</td><td>${futPct}%</td><td>${cqDays}</td><td>${fmt(cq.fut_rev / cqDays)}</td></tr>`;
  compositionHTML += `<tr><td>Cash</td><td>${fmt(cq.cash_rev)}</td><td>${cashPct}%</td><td>${cqDays}</td><td>${fmt(cq.cash_rev / cqDays)}</td></tr>`;
  compositionHTML += `<tr style="font-weight:600"><td>Total</td><td>${fmt(cq.total_rev)}</td><td>100%</td><td>${cqDays}</td><td>${fmt(cq.total_rev / cqDays)}</td></tr>`;
  compositionHTML += `</tbody>`;
  document.getElementById('tableMcxRevComposition').innerHTML = compositionHTML;
}

// ========================
// BSE: QUARTERLY ANALYSIS
// ========================

// ========================
// NSE QUARTERLY CHARTS (mirrors BSE quarterly analysis)
// ========================

function buildNSEQuarterlyCharts() {
  const q = DATA.quarterly;
  const shortLabels = q.map(x => { const p = x.quarter.split(' '); return p[0] + " '" + p[2].slice(2); });

  setCanvasHeight('chartNseQuarterlyRev', 300);
  charts.nseQuarterlyRev = new Chart(document.getElementById('chartNseQuarterlyRev'), {
    type: 'bar',
    data: {
      labels: shortLabels,
      datasets: [
        { label: 'Cash',    data: q.map(x => x.cash_rev), backgroundColor: CHART_COLORS[3], borderRadius: 2, stack: 'stack', order: 3 },
        { label: 'Futures', data: q.map(x => x.fut_rev),  backgroundColor: CHART_COLORS[1], borderRadius: 2, stack: 'stack', order: 2 },
        { label: 'Options', data: q.map(x => x.opt_rev),  backgroundColor: CHART_COLORS[0], borderRadius: 2, stack: 'stack', order: 1 },
      ]
    },
    options: {
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw),
            footer: items => 'Total: ' + fmt(items.reduce((s, i) => s + i.raw, 0))
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { stacked: true, ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });

  setCanvasHeight('chartNseQuarterlyLine', 300);
  charts.nseQuarterlyLine = new Chart(document.getElementById('chartNseQuarterlyLine'), {
    type: 'line',
    data: {
      labels: shortLabels,
      datasets: [{
        label: 'Total Revenue',
        data: q.map(x => x.total_rev),
        borderColor: CHART_COLORS[0],
        backgroundColor: CHART_COLORS[0] + '20',
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 6,
      }]
    },
    options: {
      plugins: { tooltip: { callbacks: { label: ctx => 'Total Revenue: ' + fmt(ctx.raw) } } },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });
}

// ========================
// NSE MONTHLY ANALYSIS (mirrors BSE monthly analysis)
// ========================

function buildNSEMonthlyAnalysis() {
  const m = DATA.monthly;
  const last12 = m.slice(-12);
  const labels = last12.map(x => {
    const parts = x.month.split(' ');
    return parts[parts.length - 1].slice(0, 3) + " '" + parts[1].slice(2);
  });

  setCanvasHeight('chartNseMonthlyRev', 300);
  charts.nseMonthlyRev = new Chart(document.getElementById('chartNseMonthlyRev'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Revenue',
        data: last12.map(x => x.total_rev),
        backgroundColor: CHART_COLORS[0] + '80',
        borderColor: CHART_COLORS[0],
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      plugins: { tooltip: { callbacks: { label: ctx => 'Total Revenue: ' + fmt(ctx.raw) } } },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });

  setCanvasHeight('chartNseMonthlySegment', 300);
  charts.nseMonthlySegment = new Chart(document.getElementById('chartNseMonthlySegment'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Cash',    data: last12.map(x => x.cash_rev), backgroundColor: CHART_COLORS[3], borderRadius: 2, stack: 's', order: 3 },
        { label: 'Futures', data: last12.map(x => x.fut_rev),  backgroundColor: CHART_COLORS[1], borderRadius: 2, stack: 's', order: 2 },
        { label: 'Options', data: last12.map(x => x.opt_rev),  backgroundColor: CHART_COLORS[0], borderRadius: 2, stack: 's', order: 1 },
      ]
    },
    options: {
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw),
            footer: items => 'Total: ' + fmt(items.reduce((s, i) => s + i.raw, 0))
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { stacked: true, ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });

  // Monthly table — all months
  let html = '<thead><tr><th>Month</th><th>Options</th><th>Futures</th><th>Cash</th><th>Total</th><th>Days</th><th>Daily Avg</th><th>MoM</th></tr></thead><tbody>';
  for (let i = 0; i < m.length; i++) {
    const r = m[i];
    const rDays = r.trading_days || r.days || 1;
    const dailyAvg = r.total_rev / rDays;
    const prev = i > 0 ? m[i - 1] : null;
    const prevDays = prev ? (prev.trading_days || prev.days || 1) : 1;
    const prevAvg = prev ? prev.total_rev / prevDays : null;
    const mom = prevAvg ? (dailyAvg - prevAvg) / prevAvg : null;
    html += `<tr>
      <td>${r.month}</td>
      <td>${fmt(r.opt_rev)}</td>
      <td>${fmt(r.fut_rev)}</td>
      <td>${fmt(r.cash_rev)}</td>
      <td style="font-weight:600">${fmt(r.total_rev)}</td>
      <td>${rDays}</td>
      <td>${fmt(dailyAvg)}</td>
      <td>${fmtPctSigned(mom)}</td>
    </tr>`;
  }
  html += '</tbody>';
  document.getElementById('tableNseMonthly').innerHTML = html;
}

// ========================
// BSE: MONTHLY ANALYSIS
// ========================

function buildBSEMonthlyAnalysis() {
  const m = DATA.monthly;
  const last12 = m.slice(-12);
  const labels = last12.map(x => {
    const parts = x.month.split(' ');
    return parts[parts.length - 1].slice(0, 3) + " '" + parts[1].slice(2);
  });

  // Monthly revenue trend
  setCanvasHeight('chartBseMonthlyRev', 300);
  charts.bseMonthlyRev = new Chart(document.getElementById('chartBseMonthlyRev'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Revenue',
        data: last12.map(x => x.total_rev),
        backgroundColor: CHART_COLORS[0] + '80',
        borderColor: CHART_COLORS[0],
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      plugins: { tooltip: { callbacks: { label: ctx => 'Total Revenue: ' + fmt(ctx.raw) } } },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });

  // Monthly segment chart
  setCanvasHeight('chartBseMonthlySegment', 300);
  charts.bseMonthlySegment = new Chart(document.getElementById('chartBseMonthlySegment'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Cash', data: last12.map(x => x.cash_rev), backgroundColor: CHART_COLORS[3], borderRadius: 2, stack: 's', order: 3 },
        { label: 'Futures', data: last12.map(x => x.fut_rev), backgroundColor: CHART_COLORS[1], borderRadius: 2, stack: 's', order: 2 },
        { label: 'Options', data: last12.map(x => x.opt_rev), backgroundColor: CHART_COLORS[0], borderRadius: 2, stack: 's', order: 1 },
      ]
    },
    options: {
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw),
            footer: items => 'Total: ' + fmt(items.reduce((s, i) => s + i.raw, 0))
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, font: { size: 10 } } },
        y: { stacked: true, ticks: { callback: v => '₹' + fmtNum(v, 0) + ' Cr' } }
      }
    }
  });

  // Monthly Table
  let html = '<thead><tr><th>Month</th><th>Options</th><th>Futures</th><th>Cash</th><th>Total</th><th>Days</th><th>Daily Avg</th><th>MoM</th></tr></thead><tbody>';
  for (let i = 0; i < m.length; i++) {
    const r = m[i];
    const rDays = r.trading_days || r.days || 1;
    const dailyAvg = r.total_rev / rDays;
    const prev = i > 0 ? m[i - 1] : null;
    const prevDays = prev ? (prev.trading_days || prev.days || 1) : 1;
    const prevAvg = prev ? prev.total_rev / prevDays : null;
    const mom = prevAvg ? (dailyAvg - prevAvg) / prevAvg : null;

    html += `<tr>
      <td>${r.month}</td>
      <td>${fmt(r.opt_rev)}</td>
      <td>${fmt(r.fut_rev)}</td>
      <td>${fmt(r.cash_rev)}</td>
      <td style="font-weight:600">${fmt(r.total_rev)}</td>
      <td>${rDays}</td>
      <td>${fmt(dailyAvg)}</td>
      <td>${fmtPctSigned(mom)}</td>
    </tr>`;
  }
  html += '</tbody>';
  document.getElementById('tableBseMonthly').innerHTML = html;
}

// ========================
// BSE SHARE ANALYTICS
// ========================

function filterShareSeries(ser, range, regStart) {
  const last = new Date(ser[ser.length - 1].date);
  let cutoff;
  const d = new Date(last);
  switch (range) {
    case '1m':      d.setMonth(d.getMonth() - 1);      cutoff = d.toISOString().slice(0, 10); break;
    case '3m':      d.setMonth(d.getMonth() - 3);      cutoff = d.toISOString().slice(0, 10); break;
    case '6m':      d.setMonth(d.getMonth() - 6);      cutoff = d.toISOString().slice(0, 10); break;
    case '1y':      d.setFullYear(d.getFullYear() - 1); cutoff = d.toISOString().slice(0, 10); break;
    case '2y':      d.setFullYear(d.getFullYear() - 2); cutoff = d.toISOString().slice(0, 10); break;
    case 'nov2024':
    default:        cutoff = regStart;
  }
  return ser.filter(r => r.date >= cutoff);
}

function buildBSECharts(viewSer, reg, maWin) {
  ['bseSharePrice', 'bseRevMA50', 'bseRevMaVsPrice', 'bseRatioSD', 'bseShareScatter'].forEach(k => {
    if (charts[k]) { charts[k].destroy(); charts[k] = null; }
  });
  if (!viewSer.length) return;

  const labels  = viewSer.map(r => r.date.slice(5));
  const actuals = viewSer.map(r => r.price);
  const preds   = viewSer.map(r => r.price_pred);
  const revMA   = viewSer.map(r => r.rev_ma);
  const revRaw  = viewSer.map(r => r.revenue_cr);

  // ── Chart 1: Price actual vs predicted ──
  setCanvasHeight('chartBseSharePrice', 280);
  charts.bseSharePrice = new Chart(document.getElementById('chartBseSharePrice'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Actual Price',    data: actuals, borderColor: CHART_COLORS[0], backgroundColor: 'transparent', borderWidth: 2,   pointRadius: 0, tension: 0.2 },
        { label: 'Model Prediction', data: preds,  borderColor: CHART_COLORS[2], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.2, borderDash: [5, 3] },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 0) } } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) } }
      }
    }
  });

  // ── Chart 2: Revenue — daily + MA ──
  setCanvasHeight('chartBseRevMA50', 280);
  charts.bseRevMA50 = new Chart(document.getElementById('chartBseRevMA50'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Daily Revenue', data: revRaw, borderColor: CHART_COLORS[3], backgroundColor: 'transparent', borderWidth: 1, pointRadius: 0, tension: 0.2 },
        { label: maWin + '-Day MA', data: revMA, borderColor: CHART_COLORS[0], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.2 },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 2) + ' Cr' } } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 1) + ' Cr' } }
      }
    }
  });

  // ── Chart 3: Dual-axis — Rev MA vs Share Price ──
  setCanvasHeight('chartBseRevMaVsPrice', 300);
  charts.bseRevMaVsPrice = new Chart(document.getElementById('chartBseRevMaVsPrice'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: maWin + '-Day MA Revenue (₹ Cr)', data: revMA,   borderColor: CHART_COLORS[4], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'yRev' },
        { label: 'BSE Share Price (₹)',             data: actuals, borderColor: CHART_COLORS[0], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'yPrice' },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.yAxisID === 'yRev'
              ? ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 2) + ' Cr'
              : ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 0)
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        yRev: {
          type: 'linear', position: 'left',
          title: { display: true, text: maWin + '-Day MA Rev (₹ Cr)', font: { size: 10 } },
          ticks: { callback: v => '₹' + fmtNum(v, 1) + ' Cr', font: { size: 10 } },
        },
        yPrice: {
          type: 'linear', position: 'right',
          title: { display: true, text: 'Share Price (₹)', font: { size: 10 } },
          ticks: { callback: v => '₹' + fmtNum(v, 0), font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      }
    }
  });

  // ── Chart 4: Price ÷ RevMA Ratio — Mean ± SD (recalculated for this range) ──
  const ratios = viewSer.map(r => r.price / r.rev_ma);
  const n      = ratios.length;
  const mean   = ratios.reduce((a, b) => a + b, 0) / n;
  const std    = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const flat   = val => viewSer.map(() => val);

  const sdBandOuter = CHART_COLORS[0] + '18';
  const sdBandInner = CHART_COLORS[0] + '30';
  const sdLineOuter = CHART_COLORS[0] + '55';
  const sdLineInner = CHART_COLORS[0] + '80';

  setCanvasHeight('chartBseRatioSD', 300);
  charts.bseRatioSD = new Chart(document.getElementById('chartBseRatioSD'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '+2σ',          data: flat(mean + 2 * std), borderColor: sdLineOuter, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: { target: 4 }, backgroundColor: sdBandOuter },
        { label: '+1σ',          data: flat(mean + std),     borderColor: sdLineInner, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: { target: 3 }, backgroundColor: sdBandInner },
        { label: 'Mean',         data: flat(mean),           borderColor: CHART_COLORS[4], borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, fill: false, backgroundColor: 'transparent' },
        { label: '−1σ',          data: flat(mean - std),     borderColor: sdLineInner, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false, backgroundColor: 'transparent' },
        { label: '−2σ',          data: flat(mean - 2 * std), borderColor: sdLineOuter, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false, backgroundColor: 'transparent' },
        { label: 'Price / Rev MA', data: ratios, borderColor: CHART_COLORS[1], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: false },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw.toFixed(1);
              if (ctx.dataset.label === 'Price / Rev MA') {
                const zVal = (ctx.raw - mean) / std;
                return `Ratio: ${v}  (${zVal >= 0 ? '+' : ''}${zVal.toFixed(1)}σ)`;
              }
              return ctx.dataset.label + ': ' + v;
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: {
          ticks: { font: { size: 10 }, callback: v => v.toFixed(0) },
          title: { display: true, text: 'Price ÷ Rev MA' + maWin, font: { size: 10 } },
        }
      }
    }
  });

  // ── Chart 5: Scatter (Revenue MA → Price) ──
  const scatterData = viewSer.map(r => ({ x: r.rev_ma, y: r.price }));
  const xVals = viewSer.map(r => r.rev_ma);
  const xMin  = Math.min(...xVals);
  const xMax  = Math.max(...xVals);
  const regLine = [
    { x: xMin, y: reg.slope * xMin + reg.intercept },
    { x: xMax, y: reg.slope * xMax + reg.intercept },
  ];

  setCanvasHeight('chartBseShareScatter', 260);
  charts.bseShareScatter = new Chart(document.getElementById('chartBseShareScatter'), {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Trading Days',  data: scatterData, backgroundColor: CHART_COLORS[0] + '88', pointRadius: 3 },
        { label: 'Regression Line', data: regLine, type: 'line', borderColor: CHART_COLORS[2], backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 3], pointRadius: 0 },
      ]
    },
    options: {
      plugins: {
        tooltip: { callbacks: { label: ctx => `Rev MA${maWin}: ₹${fmtNum(ctx.parsed.x, 1)} Cr | Price: ₹${fmtNum(ctx.parsed.y, 0)}` } }
      },
      scales: {
        x: { title: { display: true, text: maWin + '-Day MA Revenue (₹ Cr)' }, ticks: { callback: v => '₹' + fmtNum(v, 1) } },
        y: { title: { display: true, text: 'BSE Share Price (₹)' },            ticks: { callback: v => '₹' + fmtNum(v, 0) } }
      }
    }
  });
}

function buildBSEShareAnalysis() {
  const el = document.getElementById('bse-share-inner');
  if (!el) return;

  if (!SHARE_DATA) {
    el.innerHTML = `<div class="chart-panel" style="text-align:center;padding:48px;color:var(--color-text-muted)">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">Share analytics data not available</div>
      <div style="font-size:12px">Run scripts/bse_share_analysis.py to generate bse_share_analysis.json</div>
    </div>`;
    return;
  }

  const reg      = SHARE_DATA.regression;
  const lat      = SHARE_DATA.latest;
  const ser      = SHARE_DATA.series || [];
  const maWin    = SHARE_DATA.ma_window;
  const regStart = SHARE_DATA.regression_start || '2024-11-01';
  const r2pct    = Math.round(reg.r_squared * 100);
  const errDiff  = lat.price_pred - lat.price_actual;

  const kpiHTML = `
  <div class="share-kpi-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4);margin-bottom:var(--space-4)">
    ${kpi('Model R²',        r2pct + '%',                        reg.fit + ' fit',                           r2pct > 60 ? 'positive' : r2pct > 30 ? 'neutral' : 'negative')}
    ${kpi('Pearson r',       reg.pearson_r.toFixed(2),           'revenue ↔ price',                          '')}
    ${kpi('Predicted Price', '₹' + fmtNum(lat.price_pred, 0),   'model estimate',                           '')}
    ${kpi('Actual Price',    '₹' + fmtNum(lat.price_actual, 0), (errDiff >= 0 ? '+' : '') + fmtNum(errDiff, 0) + ' vs model', errDiff >= 0 ? 'positive' : 'negative')}
  </div>`;

  const eqHTML = `
  <div class="chart-panel" style="margin-bottom:var(--space-4);padding:20px 24px">
    <div class="chart-title">Regression Equation</div>
    <div style="font-size:20px;font-weight:700;color:var(--color-text);margin:12px 0 8px;font-family:var(--font-mono,monospace)">${reg.equation}</div>
    <div style="font-size:12px;color:var(--color-text-muted);display:flex;gap:24px;flex-wrap:wrap">
      <span>R² = ${reg.r_squared.toFixed(3)} &nbsp;|&nbsp; r = ${reg.pearson_r.toFixed(3)} &nbsp;|&nbsp; n = ${SHARE_DATA.n_days} trading days</span>
      <span>MA window: ${maWin} days &nbsp;|&nbsp; Regression from: ${regStart} &nbsp;|&nbsp; Ticker: ${SHARE_DATA.ticker}</span>
      <span>Prediction error: ${lat.error_pct} % &nbsp;|&nbsp; As of: ${lat.date}</span>
    </div>
  </div>`;

  const ranges = [
    { key: '1m',      label: '1M' },
    { key: '3m',      label: '3M' },
    { key: '6m',      label: '6M' },
    { key: 'nov2024', label: 'Nov 2024+' },
    { key: '1y',      label: '1Y' },
    { key: '2y',      label: '2Y' },
  ];
  const toggleHTML = `
  <div class="share-range-toggle">
    ${ranges.map(r => `<button class="share-range-btn${r.key === 'nov2024' ? ' active' : ''}" data-range="${r.key}">${r.label}</button>`).join('')}
  </div>`;

  const chartsHTML = `
  <div style="margin-top:var(--space-4)">
    <div class="chart-grid chart-grid-2" style="margin-bottom:var(--space-4)">
      <div class="chart-panel">
        <div class="chart-title">BSE Share Price: Actual vs Model</div>
        <div class="chart-wrapper"><canvas id="chartBseSharePrice"></canvas></div>
      </div>
      <div class="chart-panel">
        <div class="chart-title">${maWin}-Day MA Revenue (₹ Cr)</div>
        <div class="chart-wrapper"><canvas id="chartBseRevMA50"></canvas></div>
      </div>
    </div>
    <div class="chart-panel" style="margin-bottom:var(--space-4)">
      <div class="chart-title">${maWin}-Day MA Revenue vs BSE Share Price</div>
      <div class="chart-wrapper"><canvas id="chartBseRevMaVsPrice"></canvas></div>
    </div>
    <div class="chart-panel" style="margin-bottom:var(--space-4)">
      <div class="chart-title">Price ÷ Rev MA${maWin} Ratio — Mean ± SD</div>
      <div class="chart-wrapper"><canvas id="chartBseRatioSD"></canvas></div>
    </div>
    <div class="chart-panel">
      <div class="chart-title">Revenue → Price Scatter</div>
      <div class="chart-wrapper" style="max-height:300px"><canvas id="chartBseShareScatter"></canvas></div>
    </div>
  </div>`;

  const sectionHTML = `
  <div style="margin-top:var(--space-5)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)">
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-muted)">Charts</span>
      ${toggleHTML}
    </div>
    ${chartsHTML}
  </div>`;

  el.innerHTML = kpiHTML + eqHTML + sectionHTML;

  // Initial render
  buildBSECharts(filterShareSeries(ser, 'nov2024', regStart), reg, maWin);

  // Toggle listeners
  el.querySelectorAll('.share-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.share-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildBSECharts(filterShareSeries(ser, btn.dataset.range, regStart), reg, maWin);
    });
  });
}

function buildMCXCharts(viewSer, reg, maWin) {
  ['mcxSharePrice', 'mcxRevMA50', 'mcxRevMaVsPrice', 'mcxRatioSD', 'mcxShareScatter'].forEach(k => {
    if (charts[k]) { charts[k].destroy(); charts[k] = null; }
  });
  if (!viewSer.length) return;

  const labels  = viewSer.map(r => r.date.slice(5));
  const actuals = viewSer.map(r => r.price);
  const preds   = viewSer.map(r => r.price_pred);
  const revMA   = viewSer.map(r => r.rev_ma);
  const revRaw  = viewSer.map(r => r.revenue_cr);

  setCanvasHeight('chartMcxSharePrice', 280);
  charts.mcxSharePrice = new Chart(document.getElementById('chartMcxSharePrice'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Actual Price',    data: actuals, borderColor: CHART_COLORS[0], backgroundColor: 'transparent', borderWidth: 2,   pointRadius: 0, tension: 0.2 },
        { label: 'Model Prediction', data: preds,  borderColor: CHART_COLORS[2], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.2, borderDash: [5, 3] },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 0) } } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 0) } }
      }
    }
  });

  setCanvasHeight('chartMcxRevMA50', 280);
  charts.mcxRevMA50 = new Chart(document.getElementById('chartMcxRevMA50'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Daily Revenue', data: revRaw, borderColor: CHART_COLORS[3], backgroundColor: 'transparent', borderWidth: 1, pointRadius: 0, tension: 0.2 },
        { label: maWin + '-Day MA', data: revMA, borderColor: CHART_COLORS[0], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.2 },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 2) + ' Cr' } } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { ticks: { callback: v => '₹' + fmtNum(v, 1) + ' Cr' } }
      }
    }
  });

  setCanvasHeight('chartMcxRevMaVsPrice', 300);
  charts.mcxRevMaVsPrice = new Chart(document.getElementById('chartMcxRevMaVsPrice'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: maWin + '-Day MA Revenue (₹ Cr)', data: revMA,   borderColor: CHART_COLORS[4], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'yRev' },
        { label: 'MCX Share Price (₹)',             data: actuals, borderColor: CHART_COLORS[0], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'yPrice' },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.yAxisID === 'yRev'
              ? ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 2) + ' Cr'
              : ctx.dataset.label + ': ₹' + fmtNum(ctx.raw, 0)
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        yRev: {
          type: 'linear', position: 'left',
          title: { display: true, text: maWin + '-Day MA Rev (₹ Cr)', font: { size: 10 } },
          ticks: { callback: v => '₹' + fmtNum(v, 1) + ' Cr', font: { size: 10 } },
        },
        yPrice: {
          type: 'linear', position: 'right',
          title: { display: true, text: 'Share Price (₹)', font: { size: 10 } },
          ticks: { callback: v => '₹' + fmtNum(v, 0), font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      }
    }
  });

  const ratios = viewSer.map(r => r.price / r.rev_ma);
  const n      = ratios.length;
  const mean   = ratios.reduce((a, b) => a + b, 0) / n;
  const std    = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const flat   = val => viewSer.map(() => val);
  const sdBandOuter = CHART_COLORS[0] + '18';
  const sdBandInner = CHART_COLORS[0] + '30';
  const sdLineOuter = CHART_COLORS[0] + '55';
  const sdLineInner = CHART_COLORS[0] + '80';

  setCanvasHeight('chartMcxRatioSD', 300);
  charts.mcxRatioSD = new Chart(document.getElementById('chartMcxRatioSD'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '+2σ',          data: flat(mean + 2 * std), borderColor: sdLineOuter, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: { target: 4 }, backgroundColor: sdBandOuter },
        { label: '+1σ',          data: flat(mean + std),     borderColor: sdLineInner, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: { target: 3 }, backgroundColor: sdBandInner },
        { label: 'Mean',         data: flat(mean),           borderColor: CHART_COLORS[4], borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, fill: false, backgroundColor: 'transparent' },
        { label: '−1σ',          data: flat(mean - std),     borderColor: sdLineInner, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false, backgroundColor: 'transparent' },
        { label: '−2σ',          data: flat(mean - 2 * std), borderColor: sdLineOuter, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false, backgroundColor: 'transparent' },
        { label: 'Price / Rev MA', data: ratios, borderColor: CHART_COLORS[1], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: false },
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw.toFixed(1);
              if (ctx.dataset.label === 'Price / Rev MA') {
                const zVal = (ctx.raw - mean) / std;
                return `Ratio: ${v}  (${zVal >= 0 ? '+' : ''}${zVal.toFixed(1)}σ)`;
              }
              return ctx.dataset.label + ': ' + v;
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: {
          ticks: { font: { size: 10 }, callback: v => v.toFixed(0) },
          title: { display: true, text: 'Price ÷ Rev MA' + maWin, font: { size: 10 } },
        }
      }
    }
  });

  const scatterData = viewSer.map(r => ({ x: r.rev_ma, y: r.price }));
  const xVals = viewSer.map(r => r.rev_ma);
  const xMin  = Math.min(...xVals);
  const xMax  = Math.max(...xVals);
  const regLine = [
    { x: xMin, y: reg.slope * xMin + reg.intercept },
    { x: xMax, y: reg.slope * xMax + reg.intercept },
  ];

  setCanvasHeight('chartMcxShareScatter', 260);
  charts.mcxShareScatter = new Chart(document.getElementById('chartMcxShareScatter'), {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Trading Days',  data: scatterData, backgroundColor: CHART_COLORS[0] + '88', pointRadius: 3 },
        { label: 'Regression Line', data: regLine, type: 'line', borderColor: CHART_COLORS[2], backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 3], pointRadius: 0 },
      ]
    },
    options: {
      plugins: {
        tooltip: { callbacks: { label: ctx => `Rev MA${maWin}: ₹${fmtNum(ctx.parsed.x, 1)} Cr | Price: ₹${fmtNum(ctx.parsed.y, 0)}` } }
      },
      scales: {
        x: { title: { display: true, text: maWin + '-Day MA Revenue (₹ Cr)' }, ticks: { callback: v => '₹' + fmtNum(v, 1) } },
        y: { title: { display: true, text: 'MCX Share Price (₹)' },            ticks: { callback: v => '₹' + fmtNum(v, 0) } }
      }
    }
  });
}

function buildMCXShareAnalysis() {
  const el = document.getElementById('mcx-share-inner');
  if (!el) return;

  if (!SHARE_DATA) {
    el.innerHTML = `<div class="chart-panel" style="text-align:center;padding:48px;color:var(--color-text-muted)">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">Share analytics data not available</div>
      <div style="font-size:12px">Run scripts/mcx_share_analysis.py to generate mcx_share_analysis.json</div>
    </div>`;
    return;
  }

  const reg      = SHARE_DATA.regression;
  const lat      = SHARE_DATA.latest;
  const ser      = SHARE_DATA.series || [];
  const maWin    = SHARE_DATA.ma_window;
  const regStart = SHARE_DATA.regression_start || '2024-11-01';
  const r2pct    = Math.round(reg.r_squared * 100);
  const errDiff  = lat.price_pred - lat.price_actual;

  const kpiHTML = `
  <div class="share-kpi-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4);margin-bottom:var(--space-4)">
    ${kpi('Model R²',        r2pct + '%',                        reg.fit + ' fit',                           r2pct > 60 ? 'positive' : r2pct > 30 ? 'neutral' : 'negative')}
    ${kpi('Pearson r',       reg.pearson_r.toFixed(2),           'revenue ↔ price',                          '')}
    ${kpi('Predicted Price', '₹' + fmtNum(lat.price_pred, 0),   'model estimate',                           '')}
    ${kpi('Actual Price',    '₹' + fmtNum(lat.price_actual, 0), (errDiff >= 0 ? '+' : '') + fmtNum(errDiff, 0) + ' vs model', errDiff >= 0 ? 'positive' : 'negative')}
  </div>`;

  const eqHTML = `
  <div class="chart-panel" style="margin-bottom:var(--space-4);padding:20px 24px">
    <div class="chart-title">Regression Equation</div>
    <div style="font-size:20px;font-weight:700;color:var(--color-text);margin:12px 0 8px;font-family:var(--font-mono,monospace)">${reg.equation}</div>
    <div style="font-size:12px;color:var(--color-text-muted);display:flex;gap:24px;flex-wrap:wrap">
      <span>R² = ${reg.r_squared.toFixed(3)} &nbsp;|&nbsp; r = ${reg.pearson_r.toFixed(3)} &nbsp;|&nbsp; n = ${SHARE_DATA.n_days} trading days</span>
      <span>MA window: ${maWin} days &nbsp;|&nbsp; Regression from: ${regStart} &nbsp;|&nbsp; Ticker: ${SHARE_DATA.ticker}</span>
      <span>Prediction error: ${lat.error_pct} % &nbsp;|&nbsp; As of: ${lat.date}</span>
    </div>
  </div>`;

  const ranges = [
    { key: '1m',      label: '1M' },
    { key: '3m',      label: '3M' },
    { key: '6m',      label: '6M' },
    { key: 'nov2024', label: 'Nov 2024+' },
    { key: '1y',      label: '1Y' },
    { key: '2y',      label: '2Y' },
  ];
  const toggleHTML = `
  <div class="share-range-toggle">
    ${ranges.map(r => `<button class="share-range-btn${r.key === 'nov2024' ? ' active' : ''}" data-range="${r.key}">${r.label}</button>`).join('')}
  </div>`;

  const chartsHTML = `
  <div style="margin-top:var(--space-4)">
    <div class="chart-grid chart-grid-2" style="margin-bottom:var(--space-4)">
      <div class="chart-panel">
        <div class="chart-title">MCX Share Price: Actual vs Model</div>
        <div class="chart-wrapper"><canvas id="chartMcxSharePrice"></canvas></div>
      </div>
      <div class="chart-panel">
        <div class="chart-title">${maWin}-Day MA Revenue (₹ Cr)</div>
        <div class="chart-wrapper"><canvas id="chartMcxRevMA50"></canvas></div>
      </div>
    </div>
    <div class="chart-panel" style="margin-bottom:var(--space-4)">
      <div class="chart-title">${maWin}-Day MA Revenue vs MCX Share Price</div>
      <div class="chart-wrapper"><canvas id="chartMcxRevMaVsPrice"></canvas></div>
    </div>
    <div class="chart-panel" style="margin-bottom:var(--space-4)">
      <div class="chart-title">Price ÷ Rev MA${maWin} Ratio — Mean ± SD</div>
      <div class="chart-wrapper"><canvas id="chartMcxRatioSD"></canvas></div>
    </div>
    <div class="chart-panel">
      <div class="chart-title">Revenue → Price Scatter</div>
      <div class="chart-wrapper" style="max-height:300px"><canvas id="chartMcxShareScatter"></canvas></div>
    </div>
  </div>`;

  const sectionHTML = `
  <div style="margin-top:var(--space-5)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)">
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-muted)">Charts</span>
      ${toggleHTML}
    </div>
    ${chartsHTML}
  </div>`;

  el.innerHTML = kpiHTML + eqHTML + sectionHTML;

  buildMCXCharts(filterShareSeries(ser, 'nov2024', regStart), reg, maWin);

  el.querySelectorAll('.share-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.share-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildMCXCharts(filterShareSeries(ser, btn.dataset.range, regStart), reg, maWin);
    });
  });
}

function kpi(title, value, sub, sentiment) {
  const col = sentiment === 'positive' ? 'var(--color-positive)'
            : sentiment === 'negative' ? 'var(--color-negative)'
            : 'var(--color-text)';
  return `<div class="chart-panel" style="padding:16px 20px">
    <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${title}</div>
    <div style="font-size:28px;font-weight:700;color:${col};line-height:1">${value}</div>
    <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">${sub}</div>
  </div>`;
}

// ========================
// INIT
// ========================

async function init() {
  showLoading('nse');
  initExchangeSwitcher();
  buildSidebarNav('nse');
  toggleExchangeContent('nse');
  await loadExchangeData('nse');
  updateHeaderInfo();
  rebuildAll();
  hideLoading();
  updateLatestRevBanner();
  setInterval(updateLatestRevBanner, 5 * 60 * 1000);
  // Activate first tab
  const firstNavItem = document.querySelector('.nav-item[data-tab]');
  if (firstNavItem) firstNavItem.click();
}


init();
