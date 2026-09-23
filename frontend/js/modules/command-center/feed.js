import { signals, accountById, DOMAINS } from './data.js';
import { esc, relativeTime, ageInDays } from './utils.js';
import { ccState } from './state.js';
import { createTask } from './actions.js';

function matchesAccount(sigAccountId) {
  if (!ccState.activeAccountId) return true;
  if (sigAccountId === ccState.activeAccountId) return true;
  const mockAcct = accountById(sigAccountId);
  if (mockAcct && ccState.selectedAccountName) {
    const sName = ccState.selectedAccountName.toLowerCase();
    const mName = mockAcct.name.toLowerCase();
    if (sName.includes(mName) || mName.includes(sName)) return true;
    if (mockAcct.ticker && (mockAcct.ticker === ccState.selectedAccountObj?.ticker || mockAcct.ticker === ccState.selectedAccountObj?.stock_symbol)) return true;
  }
  return false;
}

function visibleSignals() {
  return signals
    .filter(s => ageInDays(s.detectedAt) <= 7) // drop out of the feed after 7 days
    .filter(s => ccState.activeDomainFilters.size === 0 || ccState.activeDomainFilters.has(s.domain))
    .filter(s => matchesAccount(s.accountId))
    .sort((a, b) => b.score - a.score); // composite score desc, never raw signal count
}

function renderFilterChips() {
  const wrap = document.getElementById('ccFeedFilters');
  if (!wrap) return;
  wrap.innerHTML = DOMAINS.map(d => {
    const active = ccState.activeDomainFilters.has(d);
    return `<button type="button" class="cc-chip cc-chip-filter ${active ? 'active' : ''}" data-domain="${esc(d)}">${esc(d)}</button>`;
  }).join('');
  wrap.querySelectorAll('[data-domain]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.domain;
      if (ccState.activeDomainFilters.has(d)) ccState.activeDomainFilters.delete(d);
      else ccState.activeDomainFilters.add(d);
      renderFeed();
    });
  });
}

function renderAccountFilterPill() {
  const wrap = document.getElementById('ccFeedAccountFilter');
  if (!wrap) return;
  if (!ccState.activeAccountId) { wrap.innerHTML = ''; return; }
  const acctName = ccState.selectedAccountName || accountById(ccState.activeAccountId)?.name || 'Account';
  wrap.innerHTML = `<button type="button" class="cc-chip cc-chip-brand cc-chip-removable" id="ccClearAccountFilter">Filtered: ${esc(acctName)} <i class="fa-solid fa-xmark"></i></button>`;
  const clearBtn = document.getElementById('ccClearAccountFilter');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const sel = document.getElementById('ccGlobalAccountSelect');
      if (sel) {
        sel.value = '';
        sel.dispatchEvent(new Event('change'));
      } else {
        ccState.activeAccountId = null;
        ccState.selectedAccountName = null;
        ccState.selectedAccountObj = null;
        renderFeed();
      }
    });
  }
}

function rowHtml(sig) {
  const acct = accountById(sig.accountId);
  const isNew = ageInDays(sig.detectedAt) <= 1.5;
  const newBadge = isNew
    ? `<span class="cc-badge cc-badge-new"><span class="cc-pulse-dot"></span>NEW</span>`
    : '';

  return `
    <li class="cc-feed-row ${isNew ? 'is-new' : 'is-old'}" data-signal-id="${esc(sig.id)}">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <span class="cc-feed-title">${esc(sig.title)}</span>
          ${newBadge}
        </div>
        <div class="cc-feed-meta">${esc(acct ? acct.name : '')} &middot; <span class="${isNew ? 'cc-time-new' : ''}">${esc(relativeTime(sig.detectedAt))}</span> &middot; <span class="cc-domain-tag">${esc(sig.domain)}</span></div>
        <div class="cc-feed-summary">${esc(sig.summary)}</div>
      </div>
      <div class="cc-feed-actions">
        <button type="button" class="cc-btn cc-btn-primary cc-btn-sm" data-act="task">Create task</button>
      </div>
    </li>`;
}

export function renderFeed() {
  renderFilterChips();
  renderAccountFilterPill();
  const list = document.getElementById('ccFeedList');
  if (!list) return;
  const rows = visibleSignals();
  if (!rows.length) {
    list.innerHTML = '<li class="cc-feed-empty">No signals match the current filters.</li>';
    return;
  }
  list.innerHTML = rows.map(rowHtml).join('');
  list.querySelectorAll('.cc-feed-row').forEach(row => {
    const sig = signals.find(s => s.id === row.dataset.signalId);
    const acct = accountById(sig.accountId);
    row.querySelector('[data-act="task"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.disabled = true;
      await createTask(acct.name, sig.title, { description: sig.summary, score: sig.score });
      btn.disabled = false;
    });
  });
}
