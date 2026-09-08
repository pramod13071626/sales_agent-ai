// Action / work-list items — client-specific tasks with status, priority,
// due dates, and an assignee. See ACTION_ITEMS_IMPLEMENTATION_PLAN.md and
// TASK_MANAGEMENT_README.md. The account-level "Action Items" tab was
// removed (tasks now live on the dedicated /tasks page and in Command
// Center); this module backs the contact-drawer's per-persona section
// (contact-drawer.js) and exports renderList/renderFilterChips so
// tasks-page/main.js can render the exact same card markup.
import { state } from './state.js';
import { esc } from './utils.js';
import { showToast } from './toast.js';
import { getCurrentUser } from './auth-client.js';

const STATUS_LABEL = { pending_review: 'Suggested', open: 'Open', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled' };
const STATUS_PILL = { pending_review: 'pill-brand', open: 'pill-brand', in_progress: 'pill-warning', done: 'pill-success', cancelled: 'pill-muted' };
const PRIORITY_PILL = { high: 'pill-danger', medium: 'pill-warning', low: 'pill-muted' };
// The four statuses a human ever sets directly via the dropdown — excludes
// 'pending_review', which only ever changes via the dedicated
// approve/reject endpoints (see ACTION_ITEMS_LLM_SUGGESTIONS_PLAN.md §1).
const EDITABLE_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];

function formatDueDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// LLM suggestions are written with the rationale/source folded into
// `description` as "...\n\nWhy: <rationale> — Source: <url>" (see
// apps/content_pipeline/db.py's create_llm_suggested_action_items — no
// dedicated columns for this to avoid a schema change). Split it back out
// so the UI can show the "why" the same way the Personality Profile shows
// its cited basis, rather than as one run-on paragraph.
function splitSuggestionDescription(description) {
  const marker = '\n\nWhy: ';
  const idx = (description || '').indexOf(marker);
  if (idx === -1) return { desc: description || '', rationale: null, sourceUrl: null };
  const desc = description.slice(0, idx);
  const whyBlock = description.slice(idx + marker.length);
  const sourceIdx = whyBlock.lastIndexOf(' — Source: ');
  if (sourceIdx === -1) return { desc, rationale: whyBlock, sourceUrl: null };
  return { desc, rationale: whyBlock.slice(0, sourceIdx), sourceUrl: whyBlock.slice(sourceIdx + ' — Source: '.length) };
}

// Fetches (or returns the cached copy of) this account's action items —
// callers that need a fresh list after a mutation should re-fetch directly
// via fetch() + updateAccountCache() instead of relying on this cache.
export async function ensureAccountActionItems(accountId) {
  if (state.actionItemsByAccount[accountId]) return state.actionItemsByAccount[accountId];
  try {
    const res = await fetch(`/api/accounts/${accountId}/action-items`);
    if (res.ok) {
      const data = await res.json();
      state.actionItemsByAccount[accountId] = data.action_items || [];
    }
  } catch (err) {
    console.error('Failed to load action items', err);
  }
  return state.actionItemsByAccount[accountId] || [];
}

async function refetchAccountActionItems(accountId) {
  try {
    const res = await fetch(`/api/accounts/${accountId}/action-items`);
    if (res.ok) {
      const data = await res.json();
      state.actionItemsByAccount[accountId] = data.action_items || [];
    }
  } catch (err) {
    console.error('Failed to refresh action items', err);
  }
}

function renderItemCard(item) {
  const isSuggestion = item.status === 'pending_review';
  const overdueClass = item.is_overdue ? 'action-item-overdue' : '';
  const due = formatDueDate(item.due_date);
  const { desc, rationale, sourceUrl } = isSuggestion
    ? splitSuggestionDescription(item.description)
    : { desc: item.description, rationale: null, sourceUrl: null };

  return `
    <div class="action-item-card ${overdueClass} ${isSuggestion ? 'action-item-suggestion' : ''}" data-item-id="${item.id}">
      <div class="action-item-main">
        <div class="action-item-title-row">
          <span class="pill ${PRIORITY_PILL[item.priority] || 'pill-muted'}">${esc(item.priority)}</span>
          ${isSuggestion ? `<span class="pill pill-brand"><i class="bi bi-stars"></i> Suggested</span>` : ''}
          <span class="action-item-title">${esc(item.title)}</span>
        </div>
        ${desc ? `<div class="action-item-desc">${esc(desc)}</div>` : ''}
        ${rationale ? `<div class="action-item-rationale"><i class="bi bi-info-circle"></i> ${esc(rationale)}${sourceUrl && sourceUrl !== 'bio' ? ` — <a href="${esc(sourceUrl)}" target="_blank" rel="noopener">source</a>` : ''}</div>` : ''}
        <div class="action-item-meta">
          ${item.persona_name ? `<span><i class="bi bi-person"></i> ${esc(item.persona_name)}</span>` : ''}
          ${due ? `<span class="${item.is_overdue ? 'action-item-overdue-text' : ''}"><i class="bi bi-calendar3"></i> ${item.is_overdue ? 'Overdue: ' : 'Due '}${esc(due)}</span>` : ''}
          ${!isSuggestion ? `<span><i class="bi bi-person-check"></i> ${item.assigned_to_name ? esc(item.assigned_to_name) : 'Unassigned'}</span>` : ''}
          ${item.source !== 'manual' ? `<span class="chip" style="padding:2px 8px;font-size:.66rem;"><i class="bi bi-magic"></i> auto</span>` : ''}
        </div>
      </div>
      <div class="action-item-controls">
        ${isSuggestion ? `
          <button type="button" class="aitem-btn" data-action="approve" data-item-id="${item.id}"><i class="bi bi-check2"></i> Approve</button>
          <button type="button" class="aitem-btn danger" data-action="reject" data-item-id="${item.id}"><i class="bi bi-x-lg"></i> Dismiss</button>
        ` : `
          <select class="aitem-select" data-action="set-status" data-item-id="${item.id}">
            ${EDITABLE_STATUSES.map(v => `<option value="${v}" ${item.status === v ? 'selected' : ''}>${STATUS_LABEL[v]}</option>`).join('')}
          </select>
          ${!item.assigned_to_id ? `<button type="button" class="aitem-btn" data-action="take" data-item-id="${item.id}"><i class="bi bi-hand-index"></i> Take</button>` : ''}
          ${item.status !== 'done' ? `<button type="button" class="aitem-btn" data-action="complete" data-item-id="${item.id}"><i class="bi bi-check2"></i> Done</button>` : ''}
          <button type="button" class="aitem-btn danger" data-action="delete" data-item-id="${item.id}"><i class="bi bi-trash"></i></button>
        `}
      </div>
    </div>
  `;
}

// Exported so the cross-account Task Management page (tasks-page.js) can
// reuse the exact same card/list/filter markup and CSS instead of
// duplicating it — both render the same shape of item (_serialize_action_item),
// just from different endpoints (/api/accounts/{id}/action-items vs
// /api/me/action-items).
export function renderList(items, filterStatus) {
  const filtered = filterStatus === 'all' ? items : items.filter(i => i.status === filterStatus);
  if (!filtered.length) {
    return `<div class="empty-block" style="padding:20px 4px;">
      <div class="empty-block-icon"><i class="bi bi-check2-square"></i></div>
      <div class="empty-block-text">No ${filterStatus === 'all' ? '' : STATUS_LABEL[filterStatus].toLowerCase() + ' '}action items yet.</div>
    </div>`;
  }
  return `<div class="action-item-list">${filtered.map(renderItemCard).join('')}</div>`;
}

export function renderFilterChips(items, activeStatus) {
  const counts = { all: items.length, pending_review: 0, open: 0, in_progress: 0, done: 0, cancelled: 0 };
  items.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
  const chip = (value, label) => `
    <button type="button" class="aitem-filter-pill ${activeStatus === value ? 'active' : ''}" data-action="filter-status" data-value="${value}">
      ${label} <span class="tab-badge">${counts[value] || 0}</span>
    </button>`;
  return `<div class="aitem-filter-bar" id="actionItemFilterBar">
    ${counts.pending_review ? chip('pending_review', 'Suggested') : ''}
    ${chip('open', 'Open')}${chip('in_progress', 'In Progress')}${chip('done', 'Done')}${chip('cancelled', 'Cancelled')}${chip('all', 'All')}
  </div>`;
}

// The account-level "Action Items" tab was removed (tasks are now managed
// from the dedicated /tasks page and the Command Center) — this module now
// only backs the contact-drawer's persona-scoped section below, plus the
// mutation handlers it and /tasks share.

// ── Contact-drawer section (persona-scoped, always-rendered like the
// drawer's other sections — see contact-drawer.js) ─────────────────────
export function renderPersonaActionItems(account, persona) {
  if (!account) {
    return `<div class="empty-block" style="padding:12px 4px;"><div class="empty-block-text">Open this contact from their account to manage action items.</div></div>`;
  }
  const items = (state.actionItemsByAccount[account.id] || []).filter(i => i.persona_id === persona.id);
  return `
    <div id="personaActionItemsBody">${renderList(items, 'all')}</div>
    <button type="button" class="aitem-btn" style="margin-top:10px;" id="personaActionItemQuickAdd" data-account-id="${account.id}" data-persona-id="${persona.id}">
      <i class="bi bi-plus-lg"></i> Add action item for ${esc(persona.name || 'this contact')}
    </button>
  `;
}

// ── Shared mutation handler — called from contact-drawer.js's delegated
// click listener for the persona-scoped section's Take/Complete/Delete/
// Approve/Reject buttons and its quick-add prompt ─────────────────────
export async function handleActionItemClick(e, account) {
  const btn = e.target.closest('[data-action="take"], [data-action="complete"], [data-action="delete"], [data-action="approve"], [data-action="reject"]');
  const quickAdd = e.target.closest('#personaActionItemQuickAdd');

  if (quickAdd) {
    const title = window.prompt('Action item title:');
    if (title && title.trim()) {
      await createActionItem(Number(quickAdd.dataset.accountId), {
        title: title.trim(), persona_id: Number(quickAdd.dataset.personaId),
      });
    }
    return true;
  }

  if (!btn) return false;
  const itemId = btn.dataset.itemId;
  const action = btn.dataset.action;
  try {
    if (action === 'take') {
      const me = getCurrentUser();
      if (!me) { showToast('Sign in to take an action item.'); return true; }
      await fetch(`/api/action-items/${itemId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to_id: me.id }),
      });
    } else if (action === 'complete') {
      await fetch(`/api/action-items/${itemId}/complete`, { method: 'POST' });
    } else if (action === 'delete') {
      if (!window.confirm('Delete this action item?')) return true;
      await fetch(`/api/action-items/${itemId}`, { method: 'DELETE' });
    } else if (action === 'approve') {
      await fetch(`/api/action-items/${itemId}/approve`, { method: 'POST' });
      showToast('Approved — assigned to you.');
    } else if (action === 'reject') {
      await fetch(`/api/action-items/${itemId}/reject`, { method: 'POST' });
      showToast('Suggestion dismissed.');
    }
    // Caller (contact-drawer.js) re-renders its own persona-scoped section
    // right after this returns — refetch here just refreshes the cache it reads from.
    await refetchAccountActionItems(account.id);
  } catch (err) {
    console.error('Action item update failed', err);
    showToast('Could not update the action item.');
  }
  return true;
}

async function createActionItem(accountId, payload) {
  try {
    const res = await fetch(`/api/accounts/${accountId}/action-items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Could not create action item');
    }
    await refetchAccountActionItems(accountId);
    showToast('Action item added.');
  } catch (err) {
    showToast(err.message);
  }
}

// ── "My Tasks" — cross-account, opened from the topbar (see topbar-auth.js) ──
export async function renderMyTasksPanel() {
  let items = [];
  try {
    const res = await fetch('/api/me/action-items');
    if (res.ok) items = (await res.json()).action_items || [];
  } catch (err) {
    console.error('Failed to load my action items', err);
  }
  state.myActionItems = items;
  const open = items.filter(i => i.status !== 'done' && i.status !== 'cancelled');
  if (!open.length) {
    return `<div class="empty-block" style="padding:20px 4px;">
      <div class="empty-block-icon"><i class="bi bi-check2-circle"></i></div>
      <div class="empty-block-text">Nothing assigned to you right now.</div>
    </div>`;
  }
  return `<div class="action-item-list">${open.map(i => `
    <div class="action-item-card ${i.is_overdue ? 'action-item-overdue' : ''}">
      <div class="action-item-main">
        <div class="action-item-title-row">
          <span class="pill ${PRIORITY_PILL[i.priority] || 'pill-muted'}">${esc(i.priority)}</span>
          <span class="action-item-title">${esc(i.title)}</span>
        </div>
        <div class="action-item-meta">
          <span><i class="bi bi-building"></i> ${esc(i.account_name || 'Account')}</span>
          ${i.due_date ? `<span class="${i.is_overdue ? 'action-item-overdue-text' : ''}"><i class="bi bi-calendar3"></i> ${i.is_overdue ? 'Overdue: ' : 'Due '}${esc(formatDueDate(i.due_date))}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('')}</div>`;
}
