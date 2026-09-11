import { kpiBase } from './data.js';
import { esc, formatMoney } from './utils.js';
import { loadMatrixAccounts } from './real-accounts.js';
import { loadRecentMovements } from './exec-movements.js';

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

// Account-level data (composite score, deal potential) and exec-change data
// are both real (see real-accounts.js / exec-movements.js). Signal velocity
// and "plays in motion" have no real backing source yet (no scored/dated
// signal feed or deals table in the DB) and stay on the mock kpiBase numbers
// — see data.js. Role tabs only relabel these cards; there's no real
// per-role account-ownership field to slice the account list by, so all
// three roles currently see the same accounts (whatever's been granted to
// this user, or everything for a super_admin).
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

const ROLE_LABELS = {
  ae: { velocity: 'Signal velocity this week', plays: 'Open plays in motion' },
  manager: { velocity: 'Team signal velocity this week', plays: 'Team plays in motion' },
  exec: { velocity: 'Portfolio signal velocity this week', plays: 'Portfolio plays in motion' },
};

export async function renderKpiStrip(role) {
  const k = await computeKpi();
  const labels = ROLE_LABELS[role] || ROLE_LABELS.ae;
  const deltaCls = k.velocityDeltaPct >= 0 ? 'cc-delta-up' : 'cc-delta-down';

  const card1 = `
    <div class="cc-kpi-card">
      <div class="cc-kpi-spark-bg">${sparklineSvg(k.velocityTrend)}</div>
      <div class="cc-kpi-label">${esc(labels.velocity)}</div>
      <div class="cc-kpi-value">${k.velocity} <span class="cc-kpi-delta ${deltaCls}">${k.velocityDeltaPct >= 0 ? '+' : ''}${k.velocityDeltaPct}%</span></div>
      <div class="cc-kpi-foot">vs. last week</div>
    </div>`;

  const card2 = k.topAccount ? `
    <div class="cc-kpi-card">
      <div class="cc-kpi-label">Top account composite score</div>
      <div class="cc-kpi-value">${k.topAccount.compositeScore}</div>
      <div class="cc-kpi-foot">${esc(k.topAccount.name)}</div>
      <div class="cc-progress"><div class="cc-progress-fill" style="width:${k.topAccount.compositeScore}%"></div></div>
    </div>` : `
    <div class="cc-kpi-card">
      <div class="cc-kpi-label">Top account composite score</div>
      <div class="cc-kpi-value">—</div>
      <div class="cc-kpi-foot">No accounts assigned yet</div>
    </div>`;

  const card3 = `
    <div class="cc-kpi-card">
      <div class="cc-kpi-label">Exec changes needing outreach</div>
      <div class="cc-kpi-value">${k.execChangesOpen}</div>
      <div class="cc-kpi-foot ${k.execAging > 0 ? 'cc-warning-text' : ''}">${k.execAging > 0 ? `${k.execAging} aging 5+ days` : 'all within outreach window'}</div>
      <div class="cc-chip-row">
        ${k.execJoined ? `<span class="cc-chip cc-chip-plain">${k.execJoined} joined</span>` : ''}
        ${k.execPromoted ? `<span class="cc-chip cc-chip-plain">${k.execPromoted} promoted</span>` : ''}
        ${k.execOther ? `<span class="cc-chip cc-chip-plain">${k.execOther} other</span>` : ''}
        ${!k.execChangesOpen ? '<span class="cc-chip cc-chip-plain">none in the last 30 days</span>' : ''}
      </div>
    </div>`;

  const card4 = `
    <div class="cc-kpi-card">
      <div class="cc-kpi-label">${esc(labels.plays)}</div>
      <div class="cc-kpi-value">${k.playsInMotion}</div>
      <div class="cc-kpi-foot ${k.playsStalled > 0 ? 'cc-warning-text' : ''}">${k.playsStalled > 0 ? `${k.playsStalled} stalled 14d` : 'no stalled plays'}</div>
      ${role === 'exec' ? `<div class="cc-chip-row"><span class="cc-chip cc-chip-brand">Q4 close est. ${formatMoney(k.q4CloseEstimate)}</span></div>` : ''}
    </div>`;

  return card1 + card2 + card3 + card4;
}
