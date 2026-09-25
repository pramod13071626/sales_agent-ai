// New/Changed Decision-Makers widget — distinct from the raw Exec Movements
// Timeline (which shows every joined/resigned/retired/promoted event across
// ALL companies, unscoped): this one is scoped to the accounts you actually
// track, filtered to joins/promotions (the ones worth an outreach move), and
// cross-referenced against your own persona directory so it tells you
// whether this is someone brand-new to map, or a role change for a contact
// you already have a relationship with.
import { esc } from './utils.js';
import { loadRealAccounts } from './real-accounts.js';
import { loadRecentMovements } from './exec-movements.js';
import { renderSkeleton } from '../skeleton.js';

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function personaNameSet(account) {
  return new Set((account.personas || []).map(p => normalizeName(p.full_name || p.name)));
}

export async function renderDecisionMakers() {
  const list = document.getElementById('ccDecisionMakersList');
  if (!list) return;
  list.innerHTML = renderSkeleton('feed-rows');

  let movements, accounts;
  try {
    [movements, accounts] = await Promise.all([loadRecentMovements(), loadRealAccounts()]);
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load decision-maker changes.</li>';
    return;
  }

  const accountsById = new Map(accounts.map(a => [a.id, a]));
  const relevant = movements.filter(m =>
    (m.type === 'joined' || m.type === 'promoted') && m.accountId && accountsById.has(m.accountId)
  );

  if (!relevant.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No new or promoted decision-makers detected in the last 30 days for your accounts.</li>';
    return;
  }

  list.innerHTML = relevant.map(m => {
    const account = accountsById.get(m.accountId);
    const known = personaNameSet(account).has(normalizeName(m.person));
    return `
      <li class="cc-feed-row cc-clickable-row" data-account-id="${m.accountId}">
        <div class="cc-feed-body">
          <div class="cc-feed-title-row">
            <span class="cc-feed-title">${esc(m.person)}</span>
            <span class="cc-badge ${known ? 'cc-badge-neutral' : 'cc-badge-warning'}">${known ? 'role change' : 'not yet mapped'}</span>
          </div>
          <div class="cc-feed-meta">${esc(m.role)} &middot; ${esc(account ? (account.name || account.display_name) : (m.company || ''))} &middot; ${esc(m.displayDate || '')}</div>
        </div>
      </li>`;
  }).join('');

  list.querySelectorAll('.cc-clickable-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.accountId;
      if (id) window.location.href = `/?account=${id}`;
    });
  });
}
