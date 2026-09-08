import { execChanges } from './data.js';
import { esc, ageInDays } from './utils.js';
import { logTouch } from './actions.js';

const TYPE_LABEL = { joined: 'Joined', resigned: 'Resigned', promoted: 'Promoted' };

function itemHtml(e, idx) {
  const aging = !e.actioned && ageInDays(e.date) >= 5;
  const dotCls = e.type === 'joined' ? 'cc-dot-joined' : 'cc-dot-neutral';
  return `
    <li class="cc-timeline-item ${aging ? 'cc-timeline-item-aging' : ''}">
      <span class="cc-timeline-dot ${dotCls}"></span>
      <div class="cc-timeline-body">
        <div class="cc-timeline-top">
          <span class="cc-timeline-person">${esc(e.person)}</span>
          <span class="cc-chip cc-chip-plain">${TYPE_LABEL[e.type]}</span>
        </div>
        <div class="cc-timeline-role">${esc(e.role)} &middot; ${esc(e.company)}</div>
        <div class="cc-timeline-date">${e.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${aging ? ' &middot; <span class="cc-warning-text">aging, no outreach logged</span>' : ''}</div>
      </div>
      ${!e.actioned ? `<button type="button" class="cc-btn cc-btn-ghost cc-btn-sm" data-idx="${idx}">Log touch</button>` : ''}
    </li>`;
}

export function renderTimeline() {
  const list = document.getElementById('ccTimelineList');
  if (!list) return;
  const sorted = [...execChanges].sort((a, b) => b.date - a.date);
  list.innerHTML = sorted.map((e, i) => itemHtml(e, execChanges.indexOf(e))).join('');
  list.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = execChanges[Number(btn.dataset.idx)];
      if (!item) return;
      logTouch(item.company, `outreach to ${item.person}`);
      item.actioned = true;
      renderTimeline();
    });
  });
}
