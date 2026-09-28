import { esc } from './utils.js';
import { logTouch } from './actions.js';
import { loadRecentMovements, markMovementActioned } from './exec-movements.js';
import { renderSkeleton } from '../skeleton.js';
import { ccState } from './state.js';
import { openDossier } from './drawer.js';
import { loadMatrixAccounts } from './real-accounts.js';

const TIMELINE_FILTERS = [
  { id: 'all', label: 'All movements' },
  { id: 'joined', label: 'Joined' },
  { id: 'promoted', label: 'Promoted' },
  { id: 'aging', label: 'Aging (5d+)' },
];

function renderTimelineFilters() {
  const wrap = document.getElementById('ccTimelineFilters');
  if (!wrap) return;
  wrap.innerHTML = TIMELINE_FILTERS.map(f => {
    const active = ccState.timelineFilter === f.id;
    return `<button type="button" class="cc-chip cc-chip-filter ${active ? 'active' : ''}" data-timeline-filter="${esc(f.id)}">${esc(f.label)}</button>`;
  }).join('');
  wrap.querySelectorAll('[data-timeline-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      ccState.timelineFilter = btn.dataset.timelineFilter;
      renderTimeline();
    });
  });
}

function itemHtml(e) {
  const aging = !e.actioned && (Date.now() - e.date.getTime()) / 86400000 >= 5;
  const dotCls = e.type === 'joined' ? 'cc-dot-joined' : 'cc-dot-neutral';
  const dateLabel = e.displayDate || e.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `
    <li class="cc-timeline-item cc-clickable-row ${aging ? 'cc-timeline-item-aging' : ''}" data-account-id="${esc(e.accountId || '')}" data-company="${esc(e.company || '')}">
      <span class="cc-timeline-dot ${dotCls}"></span>
      <div class="cc-timeline-body">
        <div class="cc-timeline-top">
          <span class="cc-timeline-person">${esc(e.person)}</span>
          <span class="cc-chip cc-chip-plain">${esc(e.type)}</span>
        </div>
        <div class="cc-timeline-role">${esc(e.role)} &middot; <strong class="cc-company-name">${esc(e.company)}</strong></div>
        <div class="cc-timeline-date">${esc(dateLabel)}${aging ? ' &middot; <span class="cc-warning-text">aging, no outreach logged</span>' : ''}</div>
      </div>
      ${!e.actioned ? `<button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-id="${e.id}">Log touch</button>` : ''}
    </li>`;
}

export async function renderTimeline() {
  renderTimelineFilters();
  const list = document.getElementById('ccTimelineList');
  if (!list) return;
  list.innerHTML = renderSkeleton('feed-rows');
  let movements;
  try {
    movements = await loadRecentMovements();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load exec movements.</li>';
    return;
  }
  if (!movements.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No exec movements in the last 30 days for your accounts.</li>';
    return;
  }

  const activeAcctId = ccState.activeAccountId;
  const activeAcctName = ccState.selectedAccountName;
  if (activeAcctId || activeAcctName) {
    movements = movements.filter(m => {
      if (activeAcctId && String(m.accountId) === String(activeAcctId)) return true;
      if (activeAcctName && m.company) {
        const c = m.company.toLowerCase();
        const a = activeAcctName.toLowerCase();
        if (c.includes(a) || a.includes(c)) return true;
      }
      return false;
    });
  }

  const filter = ccState.timelineFilter || 'all';
  const filtered = movements.filter(m => {
    if (filter === 'joined') return m.type === 'joined';
    if (filter === 'promoted') return m.type === 'promoted';
    if (filter === 'aging') return !m.actioned && (Date.now() - m.date.getTime()) / 86400000 >= 5;
    if (filter === 'other') return m.type !== 'joined' && m.type !== 'promoted';
    return true;
  });

  if (!filtered.length) {
    list.innerHTML = `<li class="cc-drawer-empty">No movements matching "${filter}".</li>`;
    return;
  }

  list.innerHTML = filtered.map(itemHtml).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = movements.find(m => String(m.id) === btn.dataset.id);
      if (!item) return;
      logTouch(item.company, `outreach to ${item.person}`);
      markMovementActioned(item.id);
      renderTimeline();
    });
  });

  // Clicking an exec timeline item opens the account dossier
  list.querySelectorAll('.cc-timeline-item').forEach(row => {
    row.addEventListener('click', async () => {
      const acctId = row.dataset.accountId;
      const company = row.dataset.company;
      const accounts = await loadMatrixAccounts().catch(() => []);
      const acct = accounts.find(a => a.id === acctId || a.name?.toLowerCase() === company?.toLowerCase());
      if (acct) openDossier(acct);
    });
  });
}
