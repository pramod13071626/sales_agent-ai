import { playbookActions, accountById } from './data.js';
import { esc } from './utils.js';
import { pushToCrm } from './actions.js';

function itemHtml(item) {
  const acct = accountById(item.accountId);
  return `
    <li class="cc-playbook-item ${item.crmSynced ? 'cc-playbook-item-done' : ''}" data-rank="${item.rank}">
      <div class="cc-playbook-rank">${item.rank}</div>
      <div class="cc-playbook-body">
        <div class="cc-playbook-title-row">
          <span class="cc-playbook-title">${esc(item.title)}</span>
          <span class="cc-chip ${item.impact === 'high' ? 'cc-chip-danger' : 'cc-chip-warning'}">${item.impact} impact</span>
        </div>
        <div class="cc-playbook-rationale">Why: ${esc(item.rationale)}</div>
        <div class="cc-playbook-account">${esc(acct ? acct.name : '')}</div>
      </div>
      <button type="button" class="cc-btn ${item.crmSynced ? 'cc-btn-done' : 'cc-btn-primary'} cc-btn-sm" data-rank="${item.rank}" ${item.crmSynced ? 'disabled' : ''}>
        ${item.crmSynced ? '<i class="bi bi-check2"></i> Synced' : 'Push to CRM'}
      </button>
    </li>`;
}

export function renderPlaybook() {
  const list = document.getElementById('ccPlaybookList');
  if (!list) return;
  list.innerHTML = playbookActions.map(itemHtml).join('');
  list.querySelectorAll('button[data-rank]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = playbookActions.find(p => p.rank === Number(btn.dataset.rank));
      if (!item || item.crmSynced) return;
      const acct = accountById(item.accountId);
      btn.disabled = true;
      const ok = await pushToCrm(acct.name, item.title, { description: item.rationale, priority: item.impact });
      if (ok) {
        item.crmSynced = true;
        renderPlaybook();
      } else {
        btn.disabled = false;
      }
    });
  });
}
