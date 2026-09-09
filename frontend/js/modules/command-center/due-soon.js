// Due-soon tasks widget — real data, GET /api/me/action-items (same
// endpoint the /tasks page uses), filtered to open/in-progress items due
// within 7 days (including overdue). Lets a rep see what's urgent without
// leaving Command Center for the full Tasks page.
import { esc } from './utils.js';
import { showToast } from '../toast.js';

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
    .slice(0, 8);
}

function rowHtml(item) {
  const due = dueLabel(item.due_date);
  return `
    <li class="cc-feed-row" data-item-id="${item.id}">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <span class="cc-feed-title">${esc(item.title)}</span>
          <span class="cc-chip ${item.priority === 'high' ? 'cc-chip-danger' : 'cc-chip-plain'}">${esc(item.priority)}</span>
        </div>
        <div class="cc-feed-meta">${esc(item.account_name || '')} &middot; <span class="${due.warn ? 'cc-warning-text' : ''}">${esc(due.text)}</span></div>
      </div>
      <div class="cc-feed-actions">
        <button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-action="remind">Send reminder</button>
        <button type="button" class="cc-btn cc-btn-primary cc-btn-sm" data-action="complete">Done</button>
      </div>
    </li>`;
}

export async function renderDueSoon() {
  const list = document.getElementById('ccDueSoonList');
  if (!list) return;
  list.innerHTML = '<li class="cc-drawer-empty">Loading…</li>';
  let items;
  try {
    items = await loadDueSoon();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load tasks.</li>';
    return;
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
