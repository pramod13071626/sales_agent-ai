import { accounts, signals, execChanges, kpiBase, accountById } from './data.js';
import { esc, formatMoney, signalStatus } from './utils.js';

const AE_ACCOUNT_IDS = new Set(['bny', 'ntrs', 'vgd']);

function scopedAccounts(role) {
  if (role === 'ae') return accounts.filter(a => AE_ACCOUNT_IDS.has(a.id));
  return accounts; // manager + exec see the full team/portfolio rollup
}

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

export function computeKpi(role) {
  const scoped = scopedAccounts(role);
  const scopedIds = new Set(scoped.map(a => a.id));
  const scopedSignals = signals.filter(s => scopedIds.has(s.accountId) && signalStatus(s.detectedAt) !== 'stale');

  const topAccount = [...scoped].sort((a, b) => b.compositeScore - a.compositeScore)[0];

  const aging = execChanges.filter(e => !e.actioned && (Date.now() - e.date.getTime()) / 86400000 >= 5);
  const joined = execChanges.filter(e => e.type === 'joined').length;
  const promoted = execChanges.filter(e => e.type === 'promoted').length;

  const coverageGapAccounts = scoped.filter(a => {
    const acctSignals = signals.filter(s => s.accountId === a.id);
    return acctSignals.length === 0 || acctSignals.every(s => signalStatus(s.detectedAt) !== 'fresh');
  });

  return {
    scoped,
    velocity: role === 'ae' ? Math.round(kpiBase.signalVelocity * (scoped.length / accounts.length)) : kpiBase.signalVelocity,
    velocityDeltaPct: kpiBase.velocityDeltaPct,
    velocityTrend: kpiBase.velocityTrend,
    topAccount,
    execChangesOpen: execChanges.length,
    execAging: aging.length,
    execJoined: joined,
    execPromoted: promoted,
    playsInMotion: kpiBase.playsInMotion,
    playsStalled: kpiBase.playsStalled,
    q4CloseEstimate: kpiBase.q4CloseEstimate,
    coverageGapCount: coverageGapAccounts.length,
    signalCount: scopedSignals.length,
  };
}

const ROLE_LABELS = {
  ae: { velocity: 'Signal velocity this week', plays: 'Open plays in motion' },
  manager: { velocity: 'Team signal velocity this week', plays: 'Team plays in motion' },
  exec: { velocity: 'Portfolio signal velocity this week', plays: 'Portfolio plays in motion' },
};

export function renderKpiStrip(role) {
  const k = computeKpi(role);
  const labels = ROLE_LABELS[role];
  const deltaCls = k.velocityDeltaPct >= 0 ? 'cc-delta-up' : 'cc-delta-down';

  const card1 = `
    <div class="cc-kpi-card">
      <div class="cc-kpi-spark-bg">${sparklineSvg(k.velocityTrend)}</div>
      <div class="cc-kpi-label">${esc(labels.velocity)}</div>
      <div class="cc-kpi-value">${k.velocity} <span class="cc-kpi-delta ${deltaCls}">${k.velocityDeltaPct >= 0 ? '+' : ''}${k.velocityDeltaPct}%</span></div>
      <div class="cc-kpi-foot">vs. last week</div>
    </div>`;

  const scorePct = Math.round(k.topAccount.compositeScore);
  const card2 = `
    <div class="cc-kpi-card">
      <div class="cc-kpi-label">Top account composite score</div>
      <div class="cc-kpi-value">${scorePct}</div>
      <div class="cc-kpi-foot">${esc(k.topAccount.name)}</div>
      <div class="cc-progress"><div class="cc-progress-fill" style="width:${scorePct}%"></div></div>
    </div>`;

  const card3 = `
    <div class="cc-kpi-card">
      <div class="cc-kpi-label">Exec changes needing outreach</div>
      <div class="cc-kpi-value">${k.execChangesOpen}</div>
      <div class="cc-kpi-foot ${k.execAging > 0 ? 'cc-warning-text' : ''}">${k.execAging > 0 ? `${k.execAging} aging 5+ days` : 'all within outreach window'}</div>
      <div class="cc-chip-row">
        <span class="cc-chip cc-chip-plain">${k.execJoined} joined</span>
        <span class="cc-chip cc-chip-plain">${k.execPromoted} promoted</span>
        ${role === 'manager' && k.coverageGapCount > 0 ? `<span class="cc-chip cc-chip-warning">${k.coverageGapCount} coverage gap${k.coverageGapCount === 1 ? '' : 's'}</span>` : ''}
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
