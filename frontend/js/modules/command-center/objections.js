// Common Objections & Pain Points widget — ranks Persona.operational_pain_points
// and Persona.key_objections (real AI-dossier fields, not fabricated) by how
// many personas across the user's accounts mention them. Aggregation happens
// server-side (GET /api/objections) rather than shipping every persona's raw
// fields to the client just to count them here.
//
// Rendered as two horizontal bar charts (Chart.js — already loaded for the
// Account Priority Matrix on this page, no new library needed) rather than
// plain ranked lists: bar length makes the frequency gap between the #1
// objection and the rest immediately visible, which a list of equal-height
// rows doesn't convey. The per-account breakdown that a list row could show
// inline moves to the tooltip instead (see renderTooltipLines below).
import { renderSkeleton } from '../skeleton.js';

let objectionsPromise = null;
let painChart = null;
let objectionChart = null;

function loadObjectionsData() {
  if (!objectionsPromise) {
    objectionsPromise = fetch('/api/objections?limit=6')
      .then(res => { if (!res.ok) throw new Error(`Failed to load objections (${res.status})`); return res.json(); });
  }
  return objectionsPromise;
}

function truncate(text, max = 46) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderTooltipLines(item) {
  const accounts = item.accounts.slice(0, 6);
  const extra = item.accounts.length - accounts.length;
  return [
    `${item.count} mention${item.count !== 1 ? 's' : ''}`,
    ...accounts.map(a => `• ${a}`),
    ...(extra > 0 ? [`+${extra} more account${extra !== 1 ? 's' : ''}`] : []),
  ];
}

function buildChart(canvas, items, barColor) {
  const data = [...items].reverse(); // Chart.js horizontal bars render bottom-up — reverse so #1 lands on top
  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.map(i => truncate(i.text)),
      datasets: [{
        data: data.map(i => i.count),
        backgroundColor: barColor,
        borderRadius: 4,
        maxBarThickness: 22,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 10 } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: 'rgba(148,163,184,.12)' } },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
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

function renderGroup(container, canvasId, title, items, emptyText, barColor) {
  if (!items.length) {
    container.innerHTML = `<div class="cc-subhead">${title}</div><div class="cc-drawer-empty">${emptyText}</div>`;
    return null;
  }
  const height = Math.max(90, items.length * 30);
  container.innerHTML = `
    <div class="cc-subhead">${title}</div>
    <div style="height:${height}px;"><canvas id="${canvasId}"></canvas></div>`;
  return buildChart(document.getElementById(canvasId), items, barColor);
}

export async function renderObjections() {
  const body = document.getElementById('ccObjectionsBody');
  if (!body) return;
  body.innerHTML = renderSkeleton('lines');

  if (painChart) { painChart.destroy(); painChart = null; }
  if (objectionChart) { objectionChart.destroy(); objectionChart = null; }

  if (typeof Chart === 'undefined') {
    body.innerHTML = '<div class="cc-drawer-empty">Chart library not loaded.</div>';
    return;
  }

  let data;
  try {
    data = await loadObjectionsData();
  } catch (err) {
    console.error(err);
    body.innerHTML = '<div class="cc-drawer-empty">Could not load objections data.</div>';
    return;
  }

  body.innerHTML = `
    <div class="cc-objections-group" id="ccPainGroup"></div>
    <div class="cc-objections-group" id="ccObjectionGroup" style="margin-top:14px;"></div>`;

  painChart = renderGroup(
    document.getElementById('ccPainGroup'), 'ccPainChart', 'Top pain points',
    data.pain_points || [], 'No pain points captured yet for your accounts.', '#FFB822'
  );
  objectionChart = renderGroup(
    document.getElementById('ccObjectionGroup'), 'ccObjectionChart', 'Top objections',
    data.objections || [], 'No objections captured yet for your accounts.', '#F5325C'
  );
}
