/**
 * MCX Daily Predictor module.
 *
 * Ported from MCX/mcx-vercel/index.html lines 2317-2772 (renderers + sparkline +
 * refresh loop) plus DOM updates from updateSnapshotFromAPI (2528-2640).
 *
 * Adjustments from source:
 *  - fetch URLs rewritten to /api/mcx?resource=...
 *  - seedForecastFromAPI() call removed (Forecast tab is skipped in this repo)
 *  - Guarded refs to refreshBtn / refreshMeta / livePill (those topbar elements
 *    don't exist in the new dashboard chrome)
 *  - Module wrapped in IIFE; only `MCXPredictor` exposed globally
 *  - Accordion wiring uses data-acc + delegated event listener (replaces inline
 *    onclick="toggleAcc('...')")
 */
(function () {
  'use strict';

  // ── Module-scoped state ───────────────────────────────────────────────────
  let sparkChartInst = null;
  let futChartInst = null;
  let optChartInst = null;
  let intradayChartInst = null;
  let futData = [], optData = [];
  let TOTAL_FUT = 0, TOTAL_OPT = 0;
  let autoRefreshInterval = null;
  const AUTO_REFRESH_MS = 2 * 60 * 1000;
  let initialised = false;

  const INTRADAY_BUCKETS = [
    { label: '09:00–10:30', tag: 'Opening + metals',  weight: 0.06 },
    { label: '10:30–12:30', tag: 'Mid-morning',       weight: 0.10 },
    { label: '12:30–15:00', tag: 'Post-lunch lull',   weight: 0.07 },
    { label: '15:00–17:00', tag: 'Pre-evening',       weight: 0.10 },
    { label: '17:00–19:30', tag: 'Europe open',       weight: 0.18 },
    { label: '19:30–22:00', tag: '★ NYMEX open',      weight: 0.34 },
    { label: '22:00–23:30', tag: 'Late session',      weight: 0.15 },
  ];

  // ── Formatters ────────────────────────────────────────────────────────────
  function fmt(n)         { return parseFloat(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  function fmtDec(n, d=2) { return parseFloat(n).toFixed(d); }

  function $(id) { return document.getElementById(id); }
  function isDarkTheme() { return document.documentElement.classList.contains('dark'); }

  // ── Accordion ─────────────────────────────────────────────────────────────
  function toggleAcc(id) {
    const panel = $(id + '-panel');
    if (!panel) return;
    const trigger = panel.previousElementSibling;
    const open = panel.classList.toggle('open');
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
  }

  function wireAccordions() {
    document.querySelectorAll('.mcx-accordion-trigger[data-acc]').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.addEventListener('click', () => toggleAcc(btn.dataset.acc));
      btn.dataset.wired = '1';
    });
  }

  // ── Tables (top futures / options) ────────────────────────────────────────
  function renderTables() {
    const ftb = $('futTable');
    if (ftb) {
      ftb.innerHTML = futData.slice(0, 10).map((f) => {
        const pct = TOTAL_FUT > 0 ? (f.notl / TOTAL_FUT * 100).toFixed(1) : '—';
        return `<tr><td>${f.sym}</td><td class="num">₹${fmt(f.notl)}</td><td class="num">${pct}%</td></tr>`;
      }).join('');
    }
    const otb = $('optTable');
    if (otb) {
      otb.innerHTML = optData.slice(0, 10).map((o) => {
        const ratio = o.ratio ? o.ratio.toFixed(3) : '—';
        return `<tr><td>${o.sym}</td><td class="num">₹${fmtDec(o.prem)}</td><td class="num">${ratio}%</td></tr>`;
      }).join('');
    }
  }

  // ── Commodity breakdown charts ────────────────────────────────────────────
  function renderCharts() {
    if (typeof Chart === 'undefined') return;
    const dark = isDarkTheme();
    const gridColor = dark ? '#333' : '#E8E6E1';
    const tickColor = dark ? '#888' : '#6B6560';
    const monoFont  = "'JetBrains Mono','SF Mono',monospace";

    const futLabels = futData.slice(0, 8).map((f) => f.sym);
    const futVals   = futData.slice(0, 8).map((f) => f.notl);
    if (futChartInst) futChartInst.destroy();
    const futCanvas = $('futChart');
    if (futCanvas) {
      futChartInst = new Chart(futCanvas, {
        type: 'bar',
        data: {
          labels: futLabels,
          datasets: [{
            data: futVals,
            backgroundColor: dark ? '#FF6B47' : '#D4380D',
            borderWidth: 0, borderRadius: 2,
          }],
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { ticks: { color: tickColor, font: { family: monoFont, size: 9 } }, grid: { display: false } },
            x: { ticks: { color: tickColor, font: { family: monoFont, size: 9 }, callback: v => '₹' + (v/1000).toFixed(0) + 'K' }, grid: { color: gridColor } },
          },
        },
      });
    }

    const optLabels = optData.slice(0, 8).map((o) => o.sym);
    const optVals   = optData.slice(0, 8).map((o) => o.prem);
    if (optChartInst) optChartInst.destroy();
    const optCanvas = $('optChart');
    if (optCanvas) {
      optChartInst = new Chart(optCanvas, {
        type: 'bar',
        data: {
          labels: optLabels,
          datasets: [{
            data: optVals,
            backgroundColor: dark ? '#5B9CF5' : '#0958D9',
            borderWidth: 0, borderRadius: 2,
          }],
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { ticks: { color: tickColor, font: { family: monoFont, size: 9 } }, grid: { display: false } },
            x: { ticks: { color: tickColor, font: { family: monoFont, size: 9 }, callback: v => '₹' + v.toFixed(0) }, grid: { color: gridColor } },
          },
        },
      });
    }
  }

  // ── Intraday volume curve ─────────────────────────────────────────────────
  function renderIntradayChart() {
    if (typeof Chart === 'undefined') return;
    const dark = isDarkTheme();
    const gridColor = dark ? '#333' : '#E8E6E1';
    const tickColor = dark ? '#888' : '#6B6560';
    const monoFont  = "'JetBrains Mono','SF Mono',monospace";

    const labels = INTRADAY_BUCKETS.map((b) => b.label);
    const values = INTRADAY_BUCKETS.map((b) => b.weight * 100);
    const colors = INTRADAY_BUCKETS.map((b) => {
      if (b.weight >= 0.30) return dark ? '#FF6B47' : '#D4380D';
      if (b.weight >= 0.15) return dark ? '#FAAD14' : '#D48806';
      return dark ? '#5B9CF5' : '#0958D9';
    });

    if (intradayChartInst) intradayChartInst.destroy();
    const canvas = $('intradayChart');
    if (canvas) {
      intradayChartInst = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, borderRadius: 2 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const b = INTRADAY_BUCKETS[ctx.dataIndex];
                  return `${b.weight * 100}% — ${b.tag}`;
                },
              },
            },
          },
          scales: {
            y: { ticks: { color: tickColor, font: { family: monoFont, size: 10 } }, grid: { display: false } },
            x: { max: 40, ticks: { color: tickColor, font: { family: monoFont, size: 9 }, callback: v => v + '%' }, grid: { color: gridColor } },
          },
        },
      });
    }

    const legend = $('intradayLegend');
    if (legend) {
      legend.innerHTML = `
        <span><span class="dot" style="background:${dark ? '#FF6B47' : '#D4380D'}"></span> ≥30% Prime</span>
        <span><span class="dot" style="background:${dark ? '#FAAD14' : '#D48806'}"></span> 15–29% High</span>
        <span><span class="dot" style="background:${dark ? '#5B9CF5' : '#0958D9'}"></span> &lt;15% Regular</span>
        <span>Evening (17:00–23:30) = 67%</span>
      `;
    }
  }

  // ── Update UI from /api/mcx?resource=refresh ──────────────────────────────
  function updateSnapshotFromAPI(d) {
    if (!d) return;
    const futRevVal = 2 * (d.proj_fut_cr || 0) * 210 / 1e7;
    const optRevVal = 2 * (d.proj_opt_cr || 0) * 4180 / 1e7;
    const totalRev  = futRevVal + optRevVal;
    const isLive    = !d.session_closed;
    const tradingDays = d.trading_days || 250;

    // Hero
    if ($('heroEyebrow'))  $('heroEyebrow').textContent = isLive ? "Today's Projected Revenue" : "Today's Final Revenue";
    if ($('heroRevenue'))  $('heroRevenue').textContent = '₹' + fmtDec(totalRev);
    const badge = $('heroBadge');
    if (badge) {
      badge.textContent = d.day_type || '—';
      badge.className = 'hero-badge ' + (d.day_type || 'low').toLowerCase();
    }

    const deltaEl = $('heroDelta');
    if (deltaEl) {
      const ma45 = parseFloat($('heroMAVal')?.textContent?.replace(/[^0-9.]/g, '')) || 13.93;
      const vsMa = ((totalRev / ma45 - 1) * 100);
      deltaEl.textContent = `vs 45d MA: ${vsMa >= 0 ? '+' : ''}${vsMa.toFixed(1)}%`;
      deltaEl.className = 'hero-delta ' + (vsMa >= 0 ? 'up' : 'down');
    }

    if ($('heroDate'))       $('heroDate').textContent = d.timestamp ? String(d.timestamp).split('T')[0] : '—';
    if ($('heroSession'))    $('heroSession').textContent = isLive ? `${d.elapsed_pct}% elapsed` : 'Session closed';
    if ($('heroRange'))      $('heroRange').textContent = (d.rev_low != null) ? `₹${fmtDec(d.rev_low, 1)}–${fmtDec(d.rev_high, 1)} Cr` : '';
    if ($('heroConfidence')) $('heroConfidence').textContent = `${d.confidence || '—'} · ±${d.uncertainty_pct || 0}%`;
    if ($('heroProgressFill')) $('heroProgressFill').style.width = (d.elapsed_pct || 0) + '%';

    if ($('heroTodayCard'))    $('heroTodayCard').textContent = '₹' + fmtDec(totalRev);
    if ($('heroTodayCardSub')) $('heroTodayCardSub').textContent = isLive ? `${d.elapsed_pct}% · ${d.confidence}` : 'Final';

    // Snapshot accordion
    if ($('snBadgeRev'))     $('snBadgeRev').textContent = '₹' + fmtDec(totalRev) + ' Cr';
    if ($('snFutNotl'))      $('snFutNotl').textContent = '₹' + fmt(d.fut_notl_cr) + ' Cr';
    if ($('snOptNotl'))      $('snOptNotl').textContent = '₹' + fmt(d.opt_notl_cr) + ' Cr';
    if ($('snOptPrem'))      $('snOptPrem').textContent = '₹' + fmt(d.opt_prem_cr) + ' Cr';
    if ($('snTotalNotl'))    $('snTotalNotl').textContent = '₹' + fmt((d.fut_notl_cr || 0) + (d.opt_notl_cr || 0)) + ' Cr';
    if ($('snFutContracts')) $('snFutContracts').textContent = (d.active_futures || 0) + ' contracts';
    if ($('snOptContracts')) $('snOptContracts').textContent = (d.active_options || 0) + ' contracts';
    if ($('snFutFormula'))   $('snFutFormula').textContent = `(2×₹${fmt(d.proj_fut_cr)}×210)`;
    if ($('snOptFormula'))   $('snOptFormula').textContent = `(2×₹${fmt(d.proj_opt_cr)}×4180)`;
    if ($('snFutRev'))       $('snFutRev').textContent = '₹' + fmtDec(futRevVal, 2) + ' Cr';
    if ($('snOptRev'))       $('snOptRev').textContent = '₹' + fmtDec(optRevVal, 2) + ' Cr';
    if ($('snTotalLabel'))   $('snTotalLabel').textContent = isLive ? 'Projected Total' : 'Actual Total';
    if ($('snTotalRev'))     $('snTotalRev').textContent = '₹' + fmtDec(totalRev) + ' Cr (±' + (d.uncertainty_pct || 0) + '%)';
    if ($('snRevRange') && d.rev_low != null) {
      $('snRevRange').textContent = '₹' + fmtDec(d.rev_low) + '–' + fmtDec(d.rev_high) + ' Cr';
    }
    if ($('snAnnual')) $('snAnnual').textContent = '₹' + Math.round(totalRev * tradingDays) + ' Cr';

    const vsModel = ((totalRev / 9.05 - 1) * 100);
    const cme = $('corrModelDelta');
    if (cme) {
      cme.textContent = (vsModel >= 0 ? '+' : '') + vsModel.toFixed(1) + '%';
      cme.style.color = vsModel >= 0 ? 'var(--mcx-positive)' : 'var(--mcx-negative)';
    }

    if ($('snDataSource')) $('snDataSource').textContent = (d.source === 'supabase_cache' ? 'Relay → Supabase' : 'MCX Direct') + ' · ' + ((d.active_futures || 0) + (d.active_options || 0)) + ' contracts';
    if ($('snStatus'))     $('snStatus').textContent = isLive ? `Open · ${d.elapsed_pct}%` : 'Closed';

    // KPIs
    if ($('kpiTotalRev'))    $('kpiTotalRev').textContent = '₹' + fmtDec(totalRev);
    if ($('kpiTotalRevLbl')) $('kpiTotalRevLbl').textContent = isLive ? 'Projected' : 'Final';
    const kdt = $('kpiDayType');
    if (kdt) {
      kdt.textContent = d.day_type || '—';
      kdt.style.color = d.day_type === 'HIGH' ? 'var(--mcx-positive)' : d.day_type === 'MEDIUM' ? 'var(--mcx-warning)' : 'var(--mcx-text-secondary)';
    }
    if ($('kpiDayTypeNote')) $('kpiDayTypeNote').textContent = (d.day_description || '').split('.')[0];
    if ($('kpiAnnual'))      $('kpiAnnual').textContent = '₹' + Math.round(totalRev * tradingDays) + ' Cr';
    if ($('kpiPremRatio'))   $('kpiPremRatio').textContent = (d.prem_notl_pct || 0).toFixed(3) + '%';
    const vsQ3 = (totalRev / 10.25 * 100).toFixed(1);
    const vsQ3El = $('kpiVsQ3');
    if (vsQ3El) {
      vsQ3El.textContent = vsQ3 + '%';
      vsQ3El.style.color = parseFloat(vsQ3) >= 100 ? 'var(--mcx-positive)' : 'var(--mcx-negative)';
    }

    // Stale banner
    const staleBanner = $('staleBanner');
    if (d.is_stale) {
      if (staleBanner) {
        staleBanner.style.display = 'flex';
        if ($('staleBannerText')) $('staleBannerText').textContent = d.stale_warning || 'Relay data may be stale';
      }
    } else if (staleBanner) {
      staleBanner.style.display = 'none';
    }

    // Tables & charts
    if (d.top_futures && d.top_futures.length) {
      futData = d.top_futures.map((f) => ({ sym: f.sym, notl: f.notl }));
      TOTAL_FUT = d.proj_fut_cr;
    }
    if (d.top_options && d.top_options.length) {
      optData = d.top_options.map((o) => ({ sym: o.sym, prem: o.prem, notl: o.notl, ratio: o.ratio || 0 }));
      TOTAL_OPT = d.proj_opt_cr;
    }
    renderTables();
    renderCharts();
    renderIntradayChart();

    // Update sparkline today point
    if (sparkChartInst) {
      const ds = sparkChartInst.data.datasets[0];
      if (ds && ds.data.length > 0) {
        ds.data[ds.data.length - 1] = totalRev;
        sparkChartInst.update('none');
      }
    }
  }

  // ── Refresh loop ──────────────────────────────────────────────────────────
  function isInsideTradingHours() {
    const now = new Date();
    const istMin = (now.getUTCHours() * 60 + now.getUTCMinutes()) + 330;
    return istMin >= 535 && istMin <= 1415;
  }

  function startAutoRefresh() {
    if (autoRefreshInterval) return;
    autoRefreshInterval = setInterval(() => {
      if (isInsideTradingHours()) doRefresh(true);
    }, AUTO_REFRESH_MS);
  }

  async function doRefresh(silent) {
    try {
      const resp = await fetch('/api/mcx?resource=refresh');
      const data = await resp.json();
      if (data.success) {
        updateSnapshotFromAPI(data);
        if (!autoRefreshInterval && isInsideTradingHours()) startAutoRefresh();
      }
    } catch (e) {
      /* silently ignore during init; manual refresh would show toast */
    }
  }

  // ── 45-day history + sparkline ────────────────────────────────────────────
  async function loadHero() {
    try {
      const resp = await fetch('/api/mcx?resource=history');
      const data = await resp.json();
      renderHero(data);
    } catch (e) {
      if ($('heroMAVal')) $('heroMAVal').textContent = '—';
    }
  }

  function renderHero(data) {
    const history = data.history || [];
    const ma45    = data.ma_45   || 13.93;
    const prev3   = history.filter((h) => !h.is_today && h.adr !== null).slice(-3);

    prev3.forEach((day, i) => {
      const vs  = ((day.adr / ma45 - 1) * 100);
      const col = vs >= 0 ? 'var(--mcx-positive)' : 'var(--mcx-negative)';
      if ($(`hd${i+1}val`)) $(`hd${i+1}val`).textContent = '₹' + fmtDec(day.adr);
      if ($(`hd${i+1}sub`)) $(`hd${i+1}sub`).innerHTML = `<span style="color:${col}">${vs>=0?'+':''}${vs.toFixed(1)}%</span> · ${day.label}`;
    });

    if ($('heroMAVal')) $('heroMAVal').textContent = '₹' + fmtDec(ma45);
    const validAdrs = history.map((h) => h.adr).filter((v) => v !== null);
    if ($('heroMARange')) $('heroMARange').textContent = validAdrs.length ? `₹${Math.min(...validAdrs).toFixed(1)}–${Math.max(...validAdrs).toFixed(1)}` : '—';

    const todayLabel = data.today_label || new Date().toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short' });
    if ($('heroDate')) $('heroDate').textContent = todayLabel;

    renderSparkline(history, ma45);
  }

  function renderSparkline(history, ma45) {
    if (typeof Chart === 'undefined') return;
    const dark = isDarkTheme();
    const monoFont = "'JetBrains Mono','SF Mono',monospace";
    const labels = history.map((h) => h.label);
    const adrs   = history.map((h) => h.is_today ? null : h.adr);
    const maLine = history.map(() => ma45);
    const pointColors = history.map((h) =>
      h.is_today ? (dark ? '#52C41A' : '#1B7D3A') :
      h.is_actual ? (dark ? '#E0DDD8' : '#1A1A1A') :
      (dark ? '#555' : '#C4C0B8')
    );
    const pointRadius = history.map((h) => h.is_today ? 6 : h.is_actual ? 3 : 2);

    if (sparkChartInst) sparkChartInst.destroy();
    const canvas = $('sparkChart');
    if (!canvas) return;
    sparkChartInst = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Daily Revenue',
            data: adrs,
            borderColor:     dark ? 'rgba(255,107,71,0.6)'  : 'rgba(212,56,13,0.5)',
            backgroundColor: dark ? 'rgba(255,107,71,0.05)' : 'rgba(212,56,13,0.04)',
            fill: true, tension: 0.25,
            pointRadius, pointBackgroundColor: pointColors,
            borderWidth: 1.5,
          },
          {
            label: '45d MA',
            data: maLine,
            borderColor: dark ? '#5B9CF5' : '#0958D9',
            borderDash: [5, 3],
            pointRadius: 0, borderWidth: 1.5, fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => '₹' + (item.raw || 0).toFixed(2) + ' Cr' } } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, color: dark ? '#555' : '#999', font: { family: monoFont, size: 9 } }, grid: { color: dark ? '#222' : '#E8E6E1' } },
          y: { ticks: { color: dark ? '#555' : '#999', font: { family: monoFont, size: 9 }, callback: v => '₹' + v.toFixed(0) }, grid: { color: dark ? '#222' : '#E8E6E1' } },
        },
      },
    });
  }

  // ── Init (idempotent) ─────────────────────────────────────────────────────
  function init() {
    if (initialised) return;
    initialised = true;
    wireAccordions();
    loadHero();
    setTimeout(() => doRefresh(true), 600);
  }

  // Expose
  window.MCXPredictor = {
    init,
    refresh: () => doRefresh(false),
  };
})();
