// Common Objections & Pain Points widgets — separate parallel panels ranking
// Persona.operational_pain_points and Persona.key_objections (real AI-dossier fields)
// by how many personas across the user's accounts mention them.
// Aggregation happens server-side (GET /api/objections) with client-side account filtering.
import { renderSkeleton } from '../skeleton.js';
import { ccState } from './state.js';

let objectionsPromise = null;
let painChart = null;
let objectionChart = null;

function loadObjectionsData() {
  if (!objectionsPromise) {
    objectionsPromise = fetch('/api/objections?limit=10')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load objections (${res.status})`);
        return res.json();
      });
  }
  return objectionsPromise;
}

function truncate(text, max = 40) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderTooltipLines(item) {
  const accounts = (item.accounts || []).slice(0, 6);
  const extra = (item.accounts || []).length - accounts.length;
  return [
    `${item.count} persona mention${item.count !== 1 ? 's' : ''}`,
    ...accounts.map(a => `• ${a}`),
    ...(extra > 0 ? [`+${extra} more account${extra !== 1 ? 's' : ''}`] : []),
  ];
}

function buildChart(canvas, items, barColor) {
  const data = [...items].slice(0, 6).reverse(); // Chart.js horizontal bars render bottom-up — reverse so #1 lands on top
  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.map(i => truncate(i.text)),
      datasets: [{
        data: data.map(i => i.count),
        backgroundColor: barColor,
        borderRadius: 4,
        maxBarThickness: 20,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 12, top: 4, bottom: 4 } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 10 } },
          grid: { color: 'rgba(148,163,184,.12)' },
        },
        y: {
          ticks: { font: { size: 11 } },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          padding: 10,
          cornerRadius: 8,
          titleFont: { size: 12, weight: '700' },
          bodyFont: { size: 11 },
          callbacks: {
            title: (t) => data[t[0].dataIndex].text,
            label: (t) => renderTooltipLines(data[t.dataIndex]),
          },
        },
      },
    },
  });
}

function renderPanel(containerId, canvasId, items, emptyText, barColor) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  if (!items || !items.length) {
    container.innerHTML = `<div class="cc-drawer-empty" style="padding:24px 16px;">${emptyText}</div>`;
    return null;
  }
  const height = Math.max(160, Math.min(240, items.length * 34));
  container.innerHTML = `<div style="height:${height}px; width:100%;"><canvas id="${canvasId}"></canvas></div>`;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return buildChart(canvas, items, barColor);
}

export async function renderObjections() {
  const painContainer = document.getElementById('ccPainBody');
  const objectionContainer = document.getElementById('ccObjectionBody');

  if (painContainer) painContainer.innerHTML = renderSkeleton('lines');
  if (objectionContainer) objectionContainer.innerHTML = renderSkeleton('lines');

  if (painChart) { painChart.destroy(); painChart = null; }
  if (objectionChart) { objectionChart.destroy(); objectionChart = null; }

  if (typeof Chart === 'undefined') {
    if (painContainer) painContainer.innerHTML = '<div class="cc-drawer-empty">Chart library not loaded.</div>';
    if (objectionContainer) objectionContainer.innerHTML = '<div class="cc-drawer-empty">Chart library not loaded.</div>';
    return;
  }

  let data;
  try {
    data = await loadObjectionsData();
  } catch (err) {
    console.error(err);
    if (painContainer) painContainer.innerHTML = '<div class="cc-drawer-empty">Could not load pain points data.</div>';
    if (objectionContainer) objectionContainer.innerHTML = '<div class="cc-drawer-empty">Could not load objections data.</div>';
    return;
  }

  let painPoints = data.pain_points || [];
  let objections = data.objections || [];

  // Account filter
  const selAcct = ccState.selectedAccountName;
  if (selAcct) {
    const selLower = selAcct.toLowerCase();
    painPoints = painPoints.filter(p => (p.accounts || []).some(a => a.toLowerCase().includes(selLower) || selLower.includes(a.toLowerCase())));
    objections = objections.filter(o => (o.accounts || []).some(a => a.toLowerCase().includes(selLower) || selLower.includes(a.toLowerCase())));
  }

  painChart = renderPanel(
    'ccPainBody', 'ccPainCanvas', painPoints,
    selAcct ? `No pain points recorded for ${selAcct}.` : 'No pain points captured yet for your accounts.',
    '#f59e0b'
  );

  objectionChart = renderPanel(
    'ccObjectionBody', 'ccObjectionCanvas', objections,
    selAcct ? `No objections recorded for ${selAcct}.` : 'No objections captured yet for your accounts.',
    '#ef4444'
  );
}
