import { getCommandCenter, isGenerated, markPlayTasked } from './generator.js';
import { esc } from './utils.js';
import { createTask } from './actions.js';
import { ccState } from './state.js';

function matchesAccount(play) {
  if (!ccState.activeAccountId) return true;
  return String(play.account_id) === String(ccState.activeAccountId);
}

function itemHtml(item) {
  return `
    <li class="cc-playbook-item cc-compact-playbook-item ${item.tasked ? 'cc-playbook-item-done' : ''}" data-rank="${item.rank}">
      <div class="cc-playbook-rank">${item.rank}</div>
      <div class="cc-playbook-body">
        <div class="cc-playbook-title-row">
          <span class="cc-playbook-title" title="${esc(item.title)}">${esc(item.title)}</span>
          <span class="cc-chip cc-chip-xs ${item.impact === 'high' ? 'cc-chip-danger' : 'cc-chip-warning'}">${esc(item.impact)}</span>
        </div>
        <div class="cc-playbook-rationale" title="${esc(item.rationale)}">Why: ${esc(item.rationale)}</div>
        <div class="cc-playbook-account" title="${esc(item.account_name)}"><i class="fa-regular fa-building" style="font-size:0.65rem; margin-right:3px;"></i>${esc(item.account_name)}</div>
      </div>
      <div class="cc-playbook-action">
        <button type="button" class="cc-btn ${item.tasked ? 'cc-btn-done' : 'cc-btn-primary'} cc-btn-xs" data-rank="${item.rank}" ${item.tasked ? 'disabled' : ''}>
          ${item.tasked ? '<i class="fa-solid fa-check"></i> In motion' : 'Start play'}
        </button>
      </div>
    </li>`;
}

export function renderPlaybook() {
  const list = document.getElementById('ccPlaybookList');
  if (!list) return;

  if (!isGenerated()) {
    list.innerHTML = '<li class="cc-drawer-empty">Not generated yet — press <strong>Generate</strong> to build this week\'s plays from the top signals.</li>';
    return;
  }
  const { playbook } = getCommandCenter();
  if (!playbook.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No plays this week — there were no signals in the last 7 days.</li>';
    return;
  }
  const actions = playbook.filter(matchesAccount);
  if (!actions.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No plays currently generated for the selected account.</li>';
    return;
  }

  list.innerHTML = actions.map(itemHtml).join('');
  list.querySelectorAll('button[data-rank]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = playbook.find(p => p.rank === Number(btn.dataset.rank));
      if (!item || item.tasked) return;
      btn.disabled = true;
      const ok = await createTask(item.account_name, item.title, {
        accountId: item.account_id, description: item.rationale, priority: item.impact, source: 'playbook',
      });
      if (ok) {
        markPlayTasked(item);
        renderPlaybook();
        document.dispatchEvent(new CustomEvent('cc:plays-changed'));
      } else {
        btn.disabled = false;
      }
    });
  });
}
