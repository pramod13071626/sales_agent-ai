import { playbookActions, accountById } from './data.js';
import { esc } from './utils.js';
import { pushToCrm } from './actions.js';
import { ccState } from './state.js';

function matchesAccount(accountId) {
  if (!ccState.activeAccountId) return true;
  if (accountId === ccState.activeAccountId) return true;
  const mockAcct = accountById(accountId);
  if (mockAcct && ccState.selectedAccountName) {
    const sName = ccState.selectedAccountName.toLowerCase();
    const mName = mockAcct.name.toLowerCase();
    if (sName.includes(mName) || mName.includes(sName)) return true;
  }
  return false;
}

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
        ${item.crmSynced ? '<i class="fa-solid fa-check"></i> Synced' : 'Push to CRM'}
      </button>
    </li>`;
}

export function renderPlaybook() {
  const list = document.getElementById('ccPlaybookList');
  if (!list) return;

  const actions = playbookActions.filter(p => matchesAccount(p.accountId));
  if (!actions.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No plays currently generated for the selected account.</li>';
    return;
  }

  list.innerHTML = actions.map(itemHtml).join('');
  list.querySelectorAll('button[data-rank]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = playbookActions.find(p => p.rank === Number(btn.dataset.rank));
      if (!item || item.crmSynced) return;
      const acct = accountById(item.accountId);
      btn.disabled = true;
      const ok = await pushToCrm(acct ? acct.name : 'Account', item.title, { description: item.rationale, priority: item.impact });
      if (ok) {
        item.crmSynced = true;
        renderPlaybook();
      } else {
        btn.disabled = false;
      }
    });
  });
}

