import { accountById, signals, execChanges } from './data.js';
import { esc, formatMoney, relativeTime } from './utils.js';
import { ccState } from './state.js';
import { logTouch, createTask } from './actions.js';

function el(id) { return document.getElementById(id); }

function bodyHtml(account) {
  const acctSignals = signals.filter(s => s.accountId === account.id).sort((a, b) => b.score - a.score);
  const acctExec = execChanges.filter(e => e.company === account.name);

  const signalRows = acctSignals.length
    ? acctSignals.map(s => `
      <div class="cc-drawer-signal-row">
        <span class="cc-drawer-signal-score">${s.score}</span>
        <div class="cc-drawer-signal-body">
          <div class="cc-drawer-signal-title">${esc(s.title)}</div>
          <div class="cc-drawer-signal-meta">${esc(s.domain)} &middot; ${esc(relativeTime(s.detectedAt))}</div>
        </div>
      </div>`).join('')
    : '<div class="cc-drawer-empty">No active signals.</div>';

  const execRows = acctExec.length
    ? acctExec.map(e => `
      <div class="cc-drawer-exec-row">
        <span class="cc-badge ${e.type === 'joined' ? 'cc-badge-joined' : 'cc-badge-neutral'}">${e.type}</span>
        <span>${esc(e.person)} &middot; ${esc(e.role)}</span>
      </div>`).join('')
    : '<div class="cc-drawer-empty">No recent exec movements.</div>';

  return `
    <div class="cc-drawer-metrics">
      <div class="cc-drawer-metric"><div class="cc-drawer-metric-label">Composite score</div><div class="cc-drawer-metric-value">${account.compositeScore}</div></div>
      <div class="cc-drawer-metric"><div class="cc-drawer-metric-label">Signal strength</div><div class="cc-drawer-metric-value">${account.signalStrength}</div></div>
      <div class="cc-drawer-metric"><div class="cc-drawer-metric-label">Engagement recency</div><div class="cc-drawer-metric-value">${account.engagementRecency}</div></div>
      <div class="cc-drawer-metric"><div class="cc-drawer-metric-label">Deal potential</div><div class="cc-drawer-metric-value">${formatMoney(account.dealPotential)}</div></div>
    </div>
    <div class="cc-drawer-section">
      <div class="cc-drawer-section-label">Signals</div>
      ${signalRows}
    </div>
    <div class="cc-drawer-section">
      <div class="cc-drawer-section-label">Exec movements</div>
      ${execRows}
    </div>
    <div class="cc-drawer-footer-actions">
      <button type="button" class="cc-btn cc-btn-ghost" id="ccDrawerLogTouch">Log touch</button>
      <button type="button" class="cc-btn cc-btn-primary" id="ccDrawerCreateTask">Create task</button>
    </div>`;
}

export function openDossier(accountId) {
  const account = accountById(accountId);
  if (!account) return;
  ccState.drawerAccountId = accountId;
  el('ccDrawerTitle').textContent = `${account.name} (${account.ticker})`;
  el('ccDrawerBody').innerHTML = bodyHtml(account);
  el('ccDrawer').classList.add('open');
  el('ccDrawerBackdrop').classList.add('open');
  el('ccDrawerLogTouch').addEventListener('click', () => logTouch(account.name));
  el('ccDrawerCreateTask').addEventListener('click', () => createTask(account.name));
}

export function closeDossier() {
  el('ccDrawer').classList.remove('open');
  el('ccDrawerBackdrop').classList.remove('open');
  ccState.drawerAccountId = null;
}

export function initDrawer() {
  el('ccDrawerClose').addEventListener('click', closeDossier);
  el('ccDrawerBackdrop').addEventListener('click', closeDossier);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDossier(); });
}
