// Due-soon tasks widget — real data, GET /api/me/action-items
import { esc } from './utils.js';
import { showToast } from '../toast.js';
import { renderSkeleton } from '../skeleton.js';
import { ccState } from './state.js';

function dueLabel(iso) {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, warn: true };
  if (days === 0) return { text: 'Due today', warn: true };
  if (days === 1) return { text: 'Due tomorrow', warn: false };
  return { text: `Due in ${days}d`, warn: false };
}

async function loadDueSoon() {
  const res = await fetch('/api/me/action-items');
  if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
  const data = await res.json();
  const cutoff = Date.now() + 7 * 86400000;
  return (data.action_items || [])
    .filter(i => (i.status === 'open' || i.status === 'in_progress') && i.due_date && new Date(i.due_date).getTime() <= cutoff)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 10);
}

function rowHtml(item) {
  const due = dueLabel(item.due_date);
  return `
    <li class="cc-feed-row cc-compact-due-row" data-item-id="${item.id}">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <span class="cc-feed-title" title="${esc(item.title)}">${esc(item.title)}</span>
          <span class="cc-chip cc-chip-xs ${item.priority === 'high' ? 'cc-chip-danger' : 'cc-chip-plain'}">${esc(item.priority)}</span>
        </div>
        <div class="cc-feed-meta">
          <span class="cc-due-acct-text" title="${esc(item.account_name || '')}">${esc(item.account_name || 'General')}</span>
          <span class="cc-meta-sep">&middot;</span>
          <span class="${due.warn ? 'cc-warning-text cc-font-medium' : 'cc-due-date-subtle'}">${esc(due.text)}</span>
        </div>
      </div>
      <div class="cc-feed-actions cc-compact-due-actions">
        <button type="button" class="cc-btn cc-btn-ghost cc-btn-xs" data-action="remind" title="Send email reminder to assignee">Send reminder</button>
        <button type="button" class="cc-btn cc-btn-primary cc-btn-xs" data-action="complete" title="Mark this task done"><i class="fa-solid fa-check"></i> Done</button>
      </div>
    </li>`;
}

export async function renderDueSoon() {
  const list = document.getElementById('ccDueSoonList');
  if (!list) return;
  list.innerHTML = renderSkeleton('feed-rows');
  let items;
  try {
    items = await loadDueSoon();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load tasks.</li>';
    return;
  }

  const activeAcctId = ccState.activeAccountId;
  const activeAcctName = ccState.selectedAccountName;
  if (activeAcctId || activeAcctName) {
    items = items.filter(i => {
      if (activeAcctId && String(i.account_id) === String(activeAcctId)) return true;
      if (activeAcctName && i.account_name) {
        const c = i.account_name.toLowerCase();
        const a = activeAcctName.toLowerCase();
        if (c.includes(a) || a.includes(c)) return true;
      }
      return false;
    });
  }

  if (!items.length) {
    list.innerHTML = '<li class="cc-drawer-empty">Nothing due in the next 7 days.</li>';
    return;
  }
  list.innerHTML = items.map(rowHtml).join('');
  list.querySelectorAll('[data-action="complete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.closest('.cc-feed-row').dataset.itemId;
      btn.disabled = true;
      try {
        await fetch(`/api/action-items/${itemId}/complete`, { method: 'POST' });
        showToast('Task marked done.');
        renderDueSoon();
      } catch (err) {
        console.error(err);
        showToast('Could not update the task.');
        btn.disabled = false;
      }
    });
  });
  list.querySelectorAll('[data-action="remind"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.closest('.cc-feed-row').dataset.itemId;
      btn.disabled = true;
      try {
        const res = await fetch(`/api/action-items/${itemId}/send-reminder`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Could not send the reminder.');
        showToast(`Reminder sent to ${data.sent_to}.`);
      } catch (err) {
        console.error(err);
        showToast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}
