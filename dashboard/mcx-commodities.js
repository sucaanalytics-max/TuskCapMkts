/**
 * MCX Commodities module.
 *
 * Ported from MCX/mcx-vercel/index.html lines 4160-4303.
 * Adjustments:
 *  - fetch URL rewritten to /api/mcx?resource=commodities&view=signals
 *  - Wrapped in IIFE; only `MCXCommodities` exposed globally
 */
(function () {
  'use strict';

  let commCache = null;
  let sectorChart = null;

  function $(id) { return document.getElementById(id); }

  function signalBadge(sig) {
    const colors = {
      STRONG_BUY: '#27ae60', BUY: '#2ecc71', NEUTRAL: '#95a5a6',
      SELL: '#e67e22', STRONG_SELL: '#e74c3c', NO_DATA: '#bdc3c7',
    };
    const c = colors[sig] || '#bdc3c7';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:600;color:#fff;background:${c}">${sig}</span>`;
  }

  function zColor(z) {
    if (z == null) return '';
    if (z >  1)   return 'color:#27ae60;font-weight:600';
    if (z >  0.5) return 'color:#2ecc71';
    if (z < -1)   return 'color:#e74c3c;font-weight:600';
    if (z < -0.5) return 'color:#e67e22';
    return '';
  }

  async function load(force) {
    if (!force && commCache && (Date.now() - commCache._ts < 300000)) {
      render(commCache);
      return;
    }
    if ($('commAsOf')) $('commAsOf').textContent = 'Loading commodity data…';
    try {
      const resp = await fetch('/api/mcx?resource=commodities&view=signals');
      const data = await resp.json();
      if (data.success) {
        data._ts = Date.now();
        commCache = data;
        render(data);
      } else if ($('commAsOf')) {
        $('commAsOf').textContent = 'Error: ' + (data.error || 'Unknown');
      }
    } catch (e) {
      if ($('commAsOf')) $('commAsOf').textContent = 'Fetch error: ' + e.message;
    }
  }

  function render(data) {
    if ($('commAsOf')) $('commAsOf').textContent = 'As of ' + (data.as_of || '—');

    const today = data.today || {};
    if ($('commExchangeTO')) {
      $('commExchangeTO').textContent =
        `Exchange Turnover: ₹${(today.exchange_turnover_cr || 0).toLocaleString()} Cr  |  ${(today.commodities || []).length} commodities`;
    }

    // Today's Lineup
    let rows = '';
    for (const c of (today.commodities || [])) {
      rows += `<tr>
        <td style="font-weight:600">${c.commodity}</td>
        <td>${c.head}</td>
        <td class="num">${(c.turnover_cr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
        <td class="num">${((c.weight || 0) * 100).toFixed(1)}%</td>
        <td>${signalBadge(c.signal)}</td>
        <td class="num" style="${zColor(c.composite_z)}">${c.composite_z != null ? c.composite_z.toFixed(3) : '—'}</td>
        <td class="num" style="${zColor(c.turnover_z)}">${c.turnover_z != null ? c.turnover_z.toFixed(3) : '—'}</td>
        <td class="num" style="${zColor(c.oi_z)}">${c.oi_z != null ? c.oi_z.toFixed(3) : '—'}</td>
        <td class="num" style="${zColor(c.volume_z)}">${c.volume_z != null ? c.volume_z.toFixed(3) : '—'}</td>
      </tr>`;
    }
    if ($('commTableBody')) $('commTableBody').innerHTML = rows;

    // Top Movers
    let movers = '';
    for (const m of (data.top_movers || [])) {
      const delta  = m.delta_z;
      const dStyle = delta > 0 ? 'color:#27ae60;font-weight:600' : delta < 0 ? 'color:#e74c3c;font-weight:600' : '';
      movers += `<tr>
        <td style="font-weight:600">${m.commodity}</td>
        <td>${m.head}</td>
        <td class="num">${m.prev_z != null ? m.prev_z.toFixed(3) : '—'}</td>
        <td class="num">${m.curr_z != null ? m.curr_z.toFixed(3) : '—'}</td>
        <td class="num" style="${dStyle}">${delta > 0 ? '+' : ''}${delta.toFixed(3)}</td>
        <td>${signalBadge(m.signal)}</td>
      </tr>`;
    }
    if ($('moversTableBody')) {
      $('moversTableBody').innerHTML = movers || '<tr><td colspan="6" style="text-align:center;color:var(--mcx-text-secondary)">No movers data</td></tr>';
    }

    // Momentum
    let mom = '';
    for (const m of (data.commodity_momentum || [])) {
      mom += `<tr>
        <td style="font-weight:600">${m.commodity}</td>
        <td>${m.head}</td>
        <td class="num" style="${zColor(m.avg_composite_z)}">${m.avg_composite_z.toFixed(3)}</td>
        <td class="num">${m.positive_day_pct.toFixed(0)}%</td>
        <td class="num" style="${zColor(m.latest_z)}">${m.latest_z != null ? m.latest_z.toFixed(3) : '—'}</td>
        <td>${signalBadge(m.signal)}</td>
      </tr>`;
    }
    if ($('momentumTableBody')) $('momentumTableBody').innerHTML = mom;

    // Sector rotation
    const rotation = data.sector_rotation || [];
    if (rotation.length > 0 && typeof Chart !== 'undefined') {
      const labels = rotation.map((r) => r.date.slice(5));
      const sectorKeys = new Set();
      rotation.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'date' && k.endsWith('_pct')) sectorKeys.add(k); }));

      const sectorColors = {
        energy_pct:           '#e74c3c',
        bullion_pct:          '#f39c12',
        base_metals_pct:      '#3498db',
        agro_commodities_pct: '#27ae60',
        index_pct:            '#9b59b6',
      };
      const sectorLabels = {
        energy_pct:           'Energy',
        bullion_pct:          'Bullion',
        base_metals_pct:      'Base Metals',
        agro_commodities_pct: 'Agro',
        index_pct:            'Index',
      };

      const datasets = [];
      for (const key of [...sectorKeys].sort()) {
        datasets.push({
          label: sectorLabels[key] || key.replace('_pct', '').replace(/_/g, ' '),
          data: rotation.map((r) => r[key] || 0),
          borderColor:     sectorColors[key] || '#95a5a6',
          backgroundColor: (sectorColors[key] || '#95a5a6') + '40',
          fill: true, tension: 0.2, pointRadius: 0,
        });
      }

      if (sectorChart) sectorChart.destroy();
      const canvas = $('sectorRotationChart');
      if (canvas) {
        sectorChart = new Chart(canvas, {
          type: 'line',
          data: { labels, datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
              x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
              y: { stacked: true, min: 0, max: 100, title: { display: true, text: 'Sector Weight (%)' } },
            },
            plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } },
          },
        });
      }
    }
  }

  window.MCXCommodities = {
    init: () => load(false),
    refresh: () => load(true),
  };
})();
