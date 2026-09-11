// Personal, cross-account Task Management page. See TASK_MANAGEMENT_README.md
// §8 — reuses action-items.js's exact card/list/filter markup (renderList,
// renderFilterChips) so a task looks identical here and on the per-account
// tab, over GET /api/me/action-items instead of the per-account endpoint.
// A team/manager-wide view is deliberately out of scope for v1 (§9) — every
// item here is already scoped server-side to "assigned to me."
import '../fetch-instrumentation.js';
import { initThemeToggle } from '../theme.js';
import { initTopbarAuth } from '../topbar-auth.js';
import { getCurrentUser } from '../auth-client.js';
import { showToast } from '../toast.js';
import { renderList, renderFilterChips } from '../action-items.js';
import { initAccountsNav } from '../command-center/accounts-nav.js';

function el(id) { return document.getElementById(id); }

const tp = {
  items: [],
  activeStatus: 'open',
  accountFilter: '',
  priorityFilter: '',
  sort: 'due',
};

function scopedItems() {
  return tp.items.filter(i => {
    if (tp.accountFilter && String(i.account_id) !== tp.accountFilter) return false;
    if (tp.priorityFilter && i.priority !== tp.priorityFilter) return false;
    return true;
  });
}

function visibleItems() {
  const scoped = scopedItems();
  const filtered = tp.activeStatus === 'all' ? scoped : scoped.filter(i => i.status === tp.activeStatus);
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return [...filtered].sort((a, b) => {
    if (tp.sort === 'priority') return (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3);
    if (tp.sort === 'account') return (a.account_name || '').localeCompare(b.account_name || '');
    if (tp.sort === 'newest') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    // 'due' (default) — soonest first, no due date last
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date) - new Date(b.due_date);
  });
}

function populateAccountFilter() {
  const select = el('tpAccountFilter');
  if (!select) return;
  const seen = new Map();
  tp.items.forEach(i => { if (i.account_id != null && !seen.has(i.account_id)) seen.set(i.account_id, i.account_name || `Account ${i.account_id}`); });
  const current = select.value;
  select.innerHTML = '<option value="">All accounts</option>' + [...seen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
  select.value = current && seen.has(Number(current)) ? current : '';
  tp.accountFilter = select.value;
}

function renderSubtitle() {
  const subtitle = el('tpSubtitle');
  if (!subtitle) return;
  const open = tp.items.filter(i => i.status === 'open' || i.status === 'in_progress');
  const overdue = open.filter(i => i.is_overdue);
  const accountCount = new Set(tp.items.map(i => i.account_id)).size;
  subtitle.textContent = `${open.length} open across ${accountCount} account${accountCount === 1 ? '' : 's'}${overdue.length ? ` · ${overdue.length} overdue` : ''}`;
}

function render() {
  renderSubtitle();
  el('tpStatusFilters').innerHTML = renderFilterChips(scopedItems(), tp.activeStatus);
  el('tpListBody').innerHTML = renderList(visibleItems(), tp.activeStatus);
}

async function refetch() {
  try {
    const res = await fetch('/api/me/action-items');
    if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
    const data = await res.json();
    tp.items = data.action_items || [];
    populateAccountFilter();
  } catch (err) {
    console.error(err);
    el('tpListBody').innerHTML = '<div class="empty-block" style="padding:20px 4px;"><div class="empty-block-text">Could not load your tasks.</div></div>';
    throw err;
  }
}

async function refetchAndRender() {
  await refetch();
  render();
}

function initFilterControls() {
  el('tpAccountFilter').addEventListener('change', (e) => { tp.accountFilter = e.target.value; render(); });
  el('tpPriorityFilter').addEventListener('change', (e) => { tp.priorityFilter = e.target.value; render(); });
  el('tpSort').addEventListener('change', (e) => { tp.sort = e.target.value; render(); });
}

function initListDelegation() {
  const list = el('tpListBody');
  const filters = el('tpStatusFilters');

  filters.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-action="filter-status"]');
    if (!chip) return;
    tp.activeStatus = chip.dataset.value;
    render();
  });

  list.addEventListener('change', async (e) => {
    const select = e.target.closest('[data-action="set-status"]');
    if (!select) return;
    try {
      await fetch(`/api/action-items/${select.dataset.itemId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: select.value }),
      });
      await refetchAndRender();
    } catch (err) {
      console.error(err);
      showToast('Could not update status.');
    }
  });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="take"], [data-action="complete"], [data-action="delete"]');
    if (!btn) return;
    const itemId = btn.dataset.itemId;
    const action = btn.dataset.action;
    try {
      if (action === 'take') {
        const me = getCurrentUser();
        if (!me) { showToast('Sign in to take a task.'); return; }
        await fetch(`/api/action-items/${itemId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_to_id: me.id }),
        });
      } else if (action === 'complete') {
        await fetch(`/api/action-items/${itemId}/complete`, { method: 'POST' });
      } else if (action === 'delete') {
        if (!window.confirm('Delete this task?')) return;
        await fetch(`/api/action-items/${itemId}`, { method: 'DELETE' });
      }
      await refetchAndRender();
    } catch (err) {
      console.error(err);
      showToast('Could not update the task.');
    }
  });
}

function init() {
  initThemeToggle();
  initAccountsNav();
  initFilterControls();
  initListDelegation();
  refetchAndRender();
}

initTopbarAuth().then((user) => {
  if (!user) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return;
  }
  if (user.role !== 'super_admin' && user.has_tasks_access === false) {
    if (user.has_command_center_access !== false) {
      window.location.href = '/command-center?no_tasks_access=1';
    } else if (user.has_dashboard_access !== false) {
      window.location.href = '/?no_tasks_access=1';
    } else {
      window.location.href = '/command-center?no_tasks_access=1';
    }
    return;
  }
  init();
});
