import { kpiBase } from './data.js';
import { esc, formatMoney } from './utils.js';
import { loadMatrixAccounts } from './real-accounts.js';
import { loadRecentMovements } from './exec-movements.js';
import { openDossier } from './drawer.js';
import { ccState } from './state.js';
import { renderTimeline } from './timeline.js';

function sparklinePath(values, w, h) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - ((v - min) / range) * h]);
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

function sparklineSvg(values) {
  const w = 100, h = 32;
  const d = sparklinePath(values, w, h);
  return `<svg class="cc-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function highlightAndScrollTo(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('cc-panel-highlight');
  // force reflow to restart animation if clicked repeatedly
  void el.offsetWidth;
  el.classList.add('cc-panel-highlight');
  setTimeout(() => el.classList.remove('cc-panel-highlight'), 2200);
}

// Account-level data (composite score, deal potential) and exec-change data
// are both real (see real-accounts.js / exec-movements.js). Signal velocity
// and "plays in motion" have no real backing source yet (no scored/dated
// signal feed or deals table in the DB) and stay on the mock kpiBase numbers
// — see data.js.
async function computeKpi() {
  const [accounts, execChangesAll] = await Promise.all([
    loadMatrixAccounts(),
    loadRecentMovements().catch(() => []),
  ]);

  const topAccount = accounts.length
    ? [...accounts].sort((a, b) => b.compositeScore - a.compositeScore)[0]
    : null;

  const aging = execChangesAll.filter(e => !e.actioned && (Date.now() - e.date.getTime()) / 86400000 >= 5);
  const joined = execChangesAll.filter(e => e.type === 'joined').length;
  const promoted = execChangesAll.filter(e => e.type === 'promoted').length;
  const other = execChangesAll.length - joined - promoted;

  return {
    accounts,
    topAccount,
    velocity: kpiBase.signalVelocity,
    velocityDeltaPct: kpiBase.velocityDeltaPct,
    velocityTrend: kpiBase.velocityTrend,
    execChangesOpen: execChangesAll.length,
    execAging: aging.length,
    execJoined: joined,
    execPromoted: promoted,
    execOther: other,
    playsInMotion: kpiBase.playsInMotion,
    playsStalled: kpiBase.playsStalled,
    q4CloseEstimate: kpiBase.q4CloseEstimate,
  };
}

export async function renderKpiStrip() {
  const k = await computeKpi();
  const deltaCls = k.velocityDeltaPct >= 0 ? 'cc-delta-up' : 'cc-delta-down';

  const card1 = `
    <div class="cc-kpi-card cc-kpi-clickable" data-kpi-action="jump-feed" title="Click to view Priority Signal Feed" tabindex="0" role="button">
      <div class="cc-kpi-spark-bg">${sparklineSvg(k.velocityTrend)}</div>
      <div class="cc-kpi-label-row">
        <span class="cc-kpi-label">Signal velocity this week</span>
        <i class="fa-solid fa-arrow-up-right-from-square cc-kpi-icon"></i>
      </div>
      <div class="cc-kpi-value">${k.velocity} <span class="cc-kpi-delta ${deltaCls}">${k.velocityDeltaPct >= 0 ? '+' : ''}${k.velocityDeltaPct}%</span></div>
      <div class="cc-kpi-foot">vs. last week &middot; <span class="cc-kpi-action-text">View Feed &rarr;</span></div>
    </div>`;

  const card3 = `
    <div class="cc-kpi-card cc-kpi-clickable" data-kpi-action="jump-timeline" title="Click to view Executive Movements" tabindex="0" role="button">
      <div class="cc-kpi-label-row">
        <span class="cc-kpi-label">Exec changes needing outreach</span>
        <i class="fa-solid fa-arrow-up-right-from-square cc-kpi-icon"></i>
      </div>
      <div class="cc-kpi-value">${k.execChangesOpen}</div>
      <div class="cc-kpi-foot ${k.execAging > 0 ? 'cc-warning-text' : ''}">
        ${k.execAging > 0 ? `${k.execAging} aging 5+ days` : 'all within outreach window'} &middot; <span class="cc-kpi-action-text">View Timeline &rarr;</span>
      </div>
      <div class="cc-chip-row">
        ${k.execAging ? `<button type="button" class="cc-chip cc-chip-interactive cc-chip-warning" data-timeline-filter="aging" title="Filter timeline by aging movements">${k.execAging} aging</button>` : ''}
        ${k.execJoined ? `<button type="button" class="cc-chip cc-chip-interactive cc-chip-plain" data-timeline-filter="joined" title="Filter timeline by newly joined execs">${k.execJoined} joined</button>` : ''}
        ${k.execPromoted ? `<button type="button" class="cc-chip cc-chip-interactive cc-chip-plain" data-timeline-filter="promoted" title="Filter timeline by promoted execs">${k.execPromoted} promoted</button>` : ''}
        ${k.execOther ? `<button type="button" class="cc-chip cc-chip-interactive cc-chip-plain" data-timeline-filter="other" title="Filter timeline by other movements">${k.execOther} other</button>` : ''}
        ${!k.execChangesOpen ? '<span class="cc-chip cc-chip-plain">none in last 30 days</span>' : ''}
      </div>
    </div>`;

  const card4 = `
    <div class="cc-kpi-card cc-kpi-clickable" data-kpi-action="jump-playbook" title="Click to view This Week's Playbook" tabindex="0" role="button">
      <div class="cc-kpi-label-row">
        <span class="cc-kpi-label">Open plays in motion</span>
        <i class="fa-solid fa-arrow-up-right-from-square cc-kpi-icon"></i>
      </div>
      <div class="cc-kpi-value">${k.playsInMotion}</div>
      <div class="cc-kpi-foot ${k.playsStalled > 0 ? 'cc-warning-text' : ''}">
        ${k.playsStalled > 0 ? `${k.playsStalled} stalled 14d` : 'no stalled plays'} &middot; <span class="cc-kpi-action-text">View Playbook &rarr;</span>
      </div>
      <div class="cc-chip-row"><span class="cc-chip cc-chip-brand">Q4 close est. ${formatMoney(k.q4CloseEstimate)}</span></div>
    </div>`;

  return { html: card1 + card3 + card4, data: k };
}

export function bindKpiListeners(container, kpiData) {
  if (!container) return;

  container.querySelectorAll('[data-kpi-action]').forEach(card => {
    const action = card.dataset.kpiAction;

    const executeAction = (e) => {
      // Don't trigger card action if a chip inside the card was clicked
      if (e.target.closest('[data-timeline-filter]')) return;

      if (action === 'jump-feed') {
        highlightAndScrollTo('.cc-feed-panel');
      } else if (action === 'jump-timeline') {
        highlightAndScrollTo('.cc-timeline-panel');
      } else if (action === 'jump-playbook') {
        highlightAndScrollTo('.cc-playbook-panel');
      }
    };

    card.addEventListener('click', executeAction);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        executeAction(e);
      }
    });
  });

  // Wire sub-chips inside KPI cards
  container.querySelectorAll('[data-timeline-filter]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const filter = chip.dataset.timelineFilter;
      ccState.timelineFilter = filter;
      renderTimeline();
      highlightAndScrollTo('.cc-timeline-panel');
    });
  });
}
