import { signals, accountById, DOMAINS } from './data.js';
import { esc, relativeTime, ageInDays } from './utils.js';
import { ccState } from './state.js';
import { logTouch, createTask } from './actions.js';

function visibleSignals() {
  return signals
    .filter(s => ageInDays(s.detectedAt) <= 7) // drop out of the feed after 7 days
    .filter(s => ccState.activeDomainFilters.size === 0 || ccState.activeDomainFilters.has(s.domain))
    .filter(s => !ccState.activeAccountId || s.accountId === ccState.activeAccountId)
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
  const acct = accountById(ccState.activeAccountId);
  wrap.innerHTML = `<button type="button" class="cc-chip cc-chip-brand cc-chip-removable" id="ccClearAccountFilter">Filtered: ${esc(acct ? acct.name : '')} <i class="bi bi-x"></i></button>`;
  document.getElementById('ccClearAccountFilter').addEventListener('click', () => {
    ccState.activeAccountId = null;
    renderFeed();
  });
}

function rowHtml(sig) {
  const acct = accountById(sig.accountId);
  const age = ageInDays(sig.detectedAt);
  const isStale = age >= 3;
  return `
    <li class="cc-feed-row ${isStale ? 'cc-feed-row-stale' : ''}" data-signal-id="${esc(sig.id)}">
      <div class="cc-feed-score">
        <div class="cc-feed-score-num">${sig.score}</div>
        <div class="cc-feed-score-bar"><div class="cc-feed-score-fill" style="width:${sig.score}%"></div></div>
      </div>
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <span class="cc-feed-title">${esc(sig.title)}</span>
          ${isStale ? '<span class="cc-badge cc-badge-stale">stale</span>' : ''}
        </div>
        <div class="cc-feed-meta">${esc(acct ? acct.name : '')} &middot; ${esc(relativeTime(sig.detectedAt))} &middot; <span class="cc-domain-tag">${esc(sig.domain)}</span></div>
        <div class="cc-feed-summary">${esc(sig.summary)}</div>
      </div>
      <div class="cc-feed-actions">
        <button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-act="touch">Log touch</button>
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
    row.querySelector('[data-act="touch"]').addEventListener('click', (e) => {
      e.stopPropagation();
      logTouch(acct.name, sig.title);
    });
    row.querySelector('[data-act="task"]').addEventListener('click', (e) => {
      e.stopPropagation();
      createTask(acct.name, sig.title);
    });
  });
}
