import { accounts } from './data.js';
import { formatMoney } from './utils.js';
import { ccState } from './state.js';
import { openDossier } from './drawer.js';
import { renderFeed } from './feed.js';

const RADIUS_MIN = 9, RADIUS_MAX = 36;
const DEAL_MIN = Math.min(...accounts.map(a => a.dealPotential));
const DEAL_MAX = Math.max(...accounts.map(a => a.dealPotential));

function radiusFor(dealPotential) {
  const t = (dealPotential - DEAL_MIN) / (DEAL_MAX - DEAL_MIN || 1);
  return RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN);
}

// Sequential blue scale — strongest composite score renders darkest.
function colorFor(score) {
  const t = Math.max(0, Math.min(1, score / 100));
  const stops = [
    { t: 0, c: [191, 219, 254] },   // light blue
    { t: 0.5, c: [59, 130, 246] },  // brand blue
    { t: 1, c: [30, 58, 138] },     // darkest blue
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = (b.t - a.t) || 1;
  const lt = (t - a.t) / span;
  const rgb = a.c.map((v, i) => Math.round(v + (b.c[i] - v) * lt));
  return `rgb(${rgb.join(',')})`;
}

const quadrantPlugin = {
  id: 'ccQuadrants',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const xMid = scales.x.getPixelForValue(50);
    const yMid = scales.y.getPixelForValue(50);
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xMid, chartArea.top);
    ctx.lineTo(xMid, chartArea.bottom);
    ctx.moveTo(chartArea.left, yMid);
    ctx.lineTo(chartArea.right, yMid);
    ctx.stroke();

    // Highlight the "act now" quadrant (top-right: high strength, high recency).
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(30,58,138,0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(xMid, chartArea.top, chartArea.right - xMid, yMid - chartArea.top);
    ctx.restore();

    const labelStyle = () => {
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(100,116,139,0.85)';
    };
    ctx.save();
    labelStyle();
    ctx.fillText('Act now', xMid + 10, chartArea.top + 16);
    ctx.fillText('Nurture', chartArea.left + 10, chartArea.top + 16);
    ctx.fillText('Re-engage', xMid + 10, chartArea.bottom - 8);
    ctx.fillText('Watch', chartArea.left + 10, chartArea.bottom - 8);
    ctx.restore();
  },
};

export function renderMatrix() {
  const canvas = document.getElementById('ccMatrixCanvas');
  if (!canvas || typeof Chart === 'undefined') return;

  const data = accounts.map(a => ({
    x: a.signalStrength,
    y: a.engagementRecency,
    r: radiusFor(a.dealPotential),
    account: a,
  }));

  if (ccState.matrixChart) {
    ccState.matrixChart.destroy();
  }

  ccState.matrixChart = new Chart(canvas.getContext('2d'), {
    type: 'bubble',
    data: {
      datasets: [{
        data,
        backgroundColor: data.map(d => colorFor(d.account.compositeScore)),
        borderColor: 'rgba(255,255,255,0.9)',
        borderWidth: 1.5,
        hoverBorderColor: '#1A1D23',
        hoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 4 },
      scales: {
        x: {
          min: 0, max: 100,
          title: { display: true, text: 'Buying signal strength', font: { size: 11, weight: '500' } },
          grid: { color: 'rgba(148,163,184,0.15)' },
          ticks: { font: { size: 10 } },
        },
        y: {
          min: 0, max: 100,
          title: { display: true, text: 'Engagement recency', font: { size: 11, weight: '500' } },
          grid: { color: 'rgba(148,163,184,0.15)' },
          ticks: { font: { size: 10 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1A1D23',
          padding: 10,
          titleFont: { size: 12, weight: '600' },
          bodyFont: { size: 11 },
          callbacks: {
            title: (items) => items[0].raw.account.name,
            label: (item) => [
              `Composite score: ${item.raw.account.compositeScore}`,
              `Deal potential: ${formatMoney(item.raw.account.dealPotential)}`,
            ],
          },
        },
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const point = data[elements[0].index];
        ccState.activeAccountId = point.account.id;
        renderFeed();
        openDossier(point.account.id);
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
    plugins: [quadrantPlugin],
  });
}
