import { getCommandCenter, isGenerated } from './generator.js';
import { esc, relativeTime, ageInDays } from './utils.js';
import { ccState } from './state.js';
import { createTask } from './actions.js';

function matchesAccount(sig) {
  if (!ccState.activeAccountId) return true;
  return String(sig.account_id) === String(ccState.activeAccountId);
}

function visibleSignals() {
  return getCommandCenter().signals
    .filter(s => ccState.activeDomainFilters.size === 0 || ccState.activeDomainFilters.has(s.category))
    .filter(matchesAccount)
    .sort((a, b) => b.score - a.score);
}

function renderFilterChips() {
  const wrap = document.getElementById('ccFeedFilters');
  if (!wrap) return;
  wrap.innerHTML = getCommandCenter().categories.map(d => {
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
  const acctName = ccState.selectedAccountName || 'Account';
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
  const isNew = ageInDays(sig.detectedAt) <= 1.5;
  const newBadge = isNew
    ? `<span class="cc-badge cc-badge-new"><span class="cc-pulse-dot"></span>NEW</span>`
    : '';
  const title = sig.url
    ? `<a class="cc-feed-title" href="${esc(sig.url)}" target="_blank" rel="noopener">${esc(sig.title)}</a>`
    : `<span class="cc-feed-title">${esc(sig.title)}</span>`;

  return `
    <li class="cc-feed-row ${isNew ? 'is-new' : 'is-old'}" data-signal-id="${esc(sig.id)}">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          ${title}
          ${newBadge}
        </div>
        <div class="cc-feed-meta">
          <strong class="cc-feed-acct">${esc(sig.account_name)}</strong> &middot; 
          <span class="${isNew ? 'cc-time-new' : ''}">${esc(relativeTime(sig.detectedAt))}</span> &middot; 
          <span class="cc-domain-tag">${esc(sig.category)}</span> &middot; 
          <span class="cc-score-tag">score ${esc(sig.score)}</span>
        </div>
        <div class="cc-feed-summary">${esc(sig.summary)}</div>
      </div>
      <div class="cc-feed-actions">
        <button type="button" class="cc-btn cc-btn-primary cc-btn-sm cc-feed-task-btn" data-act="task" title="Create task for this signal">
          <i class="fa-solid fa-plus"></i> Create task
        </button>
      </div>
    </li>`;
}

export function renderFeed() {
  renderFilterChips();
  renderAccountFilterPill();
  const list = document.getElementById('ccFeedList');
  if (!list) return;
  if (!isGenerated()) {
    list.innerHTML = '<li class="cc-feed-empty">Not generated yet — press <strong>Generate</strong> to build the feed from exec movements, hiring, news and opportunity signals.</li>';
    return;
  }
  const { signals } = getCommandCenter();
  if (!signals.length) {
    list.innerHTML = '<li class="cc-feed-empty">No signals in the last 7 days. Run the pipeline or content refresh for your accounts, then Generate again.</li>';
    return;
  }
  const rows = visibleSignals();
  if (!rows.length) {
    list.innerHTML = '<li class="cc-feed-empty">No signals match the current filters.</li>';
    return;
  }
  list.innerHTML = rows.map(rowHtml).join('');
  list.querySelectorAll('.cc-feed-row').forEach(row => {
    const sig = signals.find(s => s.id === row.dataset.signalId);
    row.querySelector('[data-act="task"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
      try {
        await createTask(sig.account_name, sig.title, {
          accountId: sig.account_id, description: sig.summary, score: sig.score, source: 'signal_feed',
        });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Tasked';
      }
    });
  });
}
