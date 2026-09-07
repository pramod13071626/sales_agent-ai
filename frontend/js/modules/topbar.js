import { state } from './state.js';
import { topbarTicker } from './dom.js';
import { computeSignals } from './signals.js';

export function renderTopbarTicker() {
  if (!topbarTicker) return;
  const totalAccounts = state.accounts.length;
  const totalContacts = state.accounts.reduce((s, a) => s + (a.total_contacts_captured || (a.personas || []).length || 0), 0);
  let totalSignals = 0;
  state.accounts.forEach(a => {
    totalSignals += computeSignals(a, null).length;
  });

  topbarTicker.innerHTML = `
    <div class="topbar-ticker-pill" title="Total enterprise accounts monitored"><i class="bi bi-buildings"></i> <strong>${totalAccounts}</strong> Accounts</div>
    <div class="topbar-ticker-pill" title="Total executive contacts & decision makers mapped"><i class="bi bi-people-fill"></i> <strong>${totalContacts}</strong> Contacts</div>
    <div class="topbar-ticker-pill" title="Active signals captured from SEC filings, web & social discourse"><i class="bi bi-lightning-charge-fill"></i> <strong>${totalSignals}</strong> Signals</div>
  `;
}
