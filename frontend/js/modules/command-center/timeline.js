import { esc } from './utils.js';
import { logTouch } from './actions.js';
import { loadRecentMovements, markMovementActioned } from './exec-movements.js';

function itemHtml(e) {
  const aging = !e.actioned && (Date.now() - e.date.getTime()) / 86400000 >= 5;
  const dotCls = e.type === 'joined' ? 'cc-dot-joined' : 'cc-dot-neutral';
  const dateLabel = e.displayDate || e.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `
    <li class="cc-timeline-item ${aging ? 'cc-timeline-item-aging' : ''}">
      <span class="cc-timeline-dot ${dotCls}"></span>
      <div class="cc-timeline-body">
        <div class="cc-timeline-top">
          <span class="cc-timeline-person">${esc(e.person)}</span>
          <span class="cc-chip cc-chip-plain">${esc(e.type)}</span>
        </div>
        <div class="cc-timeline-role">${esc(e.role)} &middot; ${esc(e.company)}</div>
        <div class="cc-timeline-date">${esc(dateLabel)}${aging ? ' &middot; <span class="cc-warning-text">aging, no outreach logged</span>' : ''}</div>
      </div>
      ${!e.actioned ? `<button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-id="${e.id}">Log touch</button>` : ''}
    </li>`;
}

export async function renderTimeline() {
  const list = document.getElementById('ccTimelineList');
  if (!list) return;
  list.innerHTML = '<li class="cc-drawer-empty">Loading exec movements…</li>';
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
  list.innerHTML = movements.map(itemHtml).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = movements.find(m => String(m.id) === btn.dataset.id);
      if (!item) return;
      logTouch(item.company, `outreach to ${item.person}`);
      markMovementActioned(item.id);
      renderTimeline();
    });
  });
}
