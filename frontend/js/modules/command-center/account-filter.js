import { loadRealAccounts } from './real-accounts.js';
import { ccState } from './state.js';
import { esc } from './utils.js';

let filterChangeHandler = null;

export async function initAccountFilter(onFilterChange) {
  filterChangeHandler = onFilterChange;
  const select = document.getElementById('ccGlobalAccountSelect');
  const clearBtn = document.getElementById('ccClearGlobalAccountBtn');
  if (!select) return;

  const accounts = await loadRealAccounts().catch(() => []);
  
  // Sort accounts alphabetically
  const sorted = [...accounts].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  select.innerHTML = `
    <option value="">All Accounts (Global Portfolio &middot; ${sorted.length})</option>
    ${sorted.map(a => `<option value="${a.id}">${esc(a.name || a.display_name)}${a.ticker ? ` (${esc(a.ticker)})` : ''}</option>`).join('')}
  `;

  // Check URL param ?account= or ?account_id=
  const params = new URLSearchParams(window.location.search);
  const initialAcct = params.get('account') || params.get('account_id') || params.get('account_key');
  if (initialAcct) {
    const found = sorted.find(a => String(a.id) === String(initialAcct) || a.key === initialAcct || a.name?.toLowerCase() === initialAcct.toLowerCase());
    if (found) {
      select.value = found.id;
      applyAccountSelection(found.id, sorted, false);
    }
  }

  select.addEventListener('change', () => {
    applyAccountSelection(select.value, sorted, true);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      select.value = '';
      applyAccountSelection('', sorted, true);
    });
  }
}

export function setGlobalAccountFilter(accountId) {
  const select = document.getElementById('ccGlobalAccountSelect');
  if (select) {
    select.value = accountId || '';
    select.dispatchEvent(new Event('change'));
  }
}

function applyAccountSelection(selectedId, accounts, updateUrl = true) {
  const clearBtn = document.getElementById('ccClearGlobalAccountBtn');
  const select = document.getElementById('ccGlobalAccountSelect');

  if (!selectedId) {
    ccState.activeAccountId = null;
    ccState.selectedAccountName = null;
    ccState.selectedAccountObj = null;
    if (clearBtn) clearBtn.style.display = 'none';
    if (select) select.classList.remove('has-filter');
  } else {
    const numericId = isNaN(Number(selectedId)) ? selectedId : Number(selectedId);
    const acct = accounts.find(a => a.id === numericId || String(a.id) === String(selectedId));
    ccState.activeAccountId = numericId;
    ccState.selectedAccountName = acct ? (acct.name || acct.display_name) : null;
    ccState.selectedAccountObj = acct || null;
    if (clearBtn) clearBtn.style.display = 'inline-flex';
    if (select) select.classList.add('has-filter');
  }

  if (updateUrl) {
    const url = new URL(window.location.href);
    if (ccState.activeAccountId) {
      url.searchParams.set('account_id', String(ccState.activeAccountId));
    } else {
      url.searchParams.delete('account_id');
      url.searchParams.delete('account');
      url.searchParams.delete('account_key');
    }
    history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
  }

  if (typeof filterChangeHandler === 'function') {
    filterChangeHandler(ccState.activeAccountId, ccState.selectedAccountObj);
  }
}
