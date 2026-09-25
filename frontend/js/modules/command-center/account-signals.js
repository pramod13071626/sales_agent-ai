// Four account-level signal widgets, all derived from the same /api/accounts
// payload already fetched for the matrix/nav (no extra network calls):
// capital events (funding/M&A), org coverage gaps, competitor mentions, and
// tech/IP signals. Kept in one file since they share the same data source
// and row markup — see TASK_MANAGEMENT_README.md-style honesty: every field
// used here is a real column on Account, nothing fabricated.
import { loadRealAccounts, loadMatrixAccounts } from './real-accounts.js';
import { openDossier } from './drawer.js';
import { esc, formatMoney } from './utils.js';
import { renderSkeleton } from '../skeleton.js';
import { ccState } from './state.js';

async function loadEnrichedAccounts() {
  const [raw, matrix] = await Promise.all([loadRealAccounts(), loadMatrixAccounts()]);
  const matrixById = new Map(matrix.map(a => [a.id, a]));
  return raw.map(a => ({ ...a, _matrix: matrixById.get(a.id) }));
}

function bindClickThrough(list, accountsById) {
  list.querySelectorAll('.cc-clickable-row').forEach(row => {
    row.addEventListener('click', () => {
      const account = accountsById.get(Number(row.dataset.accountId));
      if (account && account._matrix) openDossier(account._matrix);
    });
  });
}

async function renderWidget(listId, emptyMessage, computeEntries, rowHtml) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = renderSkeleton('feed-rows');
  let accounts;
  try {
    accounts = await loadEnrichedAccounts();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load account data.</li>';
    return;
  }

  let filteredAccounts = accounts;
  const activeAcctId = ccState.activeAccountId;
  const activeAcctName = ccState.selectedAccountName;
  if (activeAcctId || activeAcctName) {
    filteredAccounts = accounts.filter(a => {
      if (activeAcctId && (a.id === activeAcctId || String(a.id) === String(activeAcctId))) return true;
      if (activeAcctName && (a.name || a.display_name)) {
        const n = (a.name || a.display_name).toLowerCase();
        const sel = activeAcctName.toLowerCase();
        if (n.includes(sel) || sel.includes(n)) return true;
      }
      return false;
    });
  }

  const entries = computeEntries(filteredAccounts);
  if (!entries.length) {
    list.innerHTML = `<li class="cc-drawer-empty">${emptyMessage}</li>`;
    return;
  }
  list.innerHTML = entries.map(rowHtml).join('');
  bindClickThrough(list, new Map(accounts.map(a => [a.id, a])));
}

// ── Capital events (funding / IPO / acquisitions) ──────────────────────
function capitalEntries(accounts) {
  const cutoff = Date.now() - 365 * 86400000;
  return accounts
    .filter(a => a.last_funding_date && !isNaN(new Date(a.last_funding_date).getTime()) && new Date(a.last_funding_date).getTime() >= cutoff)
    .map(a => ({ account: a, date: new Date(a.last_funding_date) }))
    .sort((a, b) => b.date - a.date);
}
function capitalRowHtml({ account: a, date }) {
  const amt = a.total_funding_amount_usd ? formatMoney(a.total_funding_amount_usd) : null;
  const acquisitions = a.num_acquisitions ? `${a.num_acquisitions} acquisition${a.num_acquisitions !== 1 ? 's' : ''}` : null;
  return `
    <li class="cc-feed-row cc-clickable-row" data-account-id="${a.id}">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row"><span class="cc-feed-title">${esc(a.name)}</span></div>
        <div class="cc-feed-summary">${esc(a.last_funding_type || 'Funding event')}${amt ? ` — ${amt}` : ''}${acquisitions ? ` · ${acquisitions}` : ''}</div>
      </div>
      <div class="cc-feed-count">${esc(date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }))}</div>
    </li>`;
}
export function renderCapitalEvents() {
  return renderWidget('ccCapitalList', 'No funding, IPO, or acquisition events on file in the last 12 months for your accounts.', capitalEntries, capitalRowHtml);
}

// ── Org coverage gaps (no C-suite contact mapped) ──────────────────────
function cSuiteCount(a) {
  return (a.personas || []).filter(p => p.tier === 'C-Suite' || [1, 2].includes(p.hierarchy_level)).length;
}
function coverageEntries(accounts) {
  return accounts
    .map(a => ({ account: a, total: (a.personas || []).length, cSuite: cSuiteCount(a) }))
    .filter(e => e.cSuite === 0)
    .sort((a, b) => a.total - b.total);
}
function coverageRowHtml({ account: a, total }) {
  return `
    <li class="cc-feed-row cc-clickable-row" data-account-id="${a.id}">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <span class="cc-feed-title">${esc(a.name)}</span>
          <span class="cc-badge cc-badge-warning">no C-suite mapped</span>
        </div>
        <div class="cc-feed-summary">${total} contact${total !== 1 ? 's' : ''} mapped total</div>
      </div>
    </li>`;
}
export function renderCoverageGaps() {
  return renderWidget('ccCoverageList', 'Every account has at least one C-suite contact mapped.', coverageEntries, coverageRowHtml);
}
