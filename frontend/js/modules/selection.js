import { state } from './state.js';
import { dashBody, dashEmpty, dashContent, dashPeople, signalModalBody } from './dom.js';
import { closeContactDrawer } from './contact-drawer.js';
import { closeSignalModal } from './signal-modal.js';
import { renderNavTree } from './nav-tree.js';
import { renderDigest } from './digest.js';
import { renderCenter } from './account-tabs.js';
import { renderPeople } from './people-panel.js';
import { renderAllJobsPage, openAllJobsPage } from './jobs-browser.js';
import { syncOpportunitySignals } from './opportunities.js';
import { syncWeeklyUpdate } from './weekly-update.js';
import { renderSkeleton } from './skeleton.js';

// Full per-account detail (persona dossiers, LOB financials/patents, org chart) is
// intentionally NOT included in the bulk /api/accounts payload (see api.py's
// _serialize_account_summary) — fetched once here, on first selection, and merged
// into the existing state.accounts entry in place so every other module's
// `.find(a => a.id === ...)` call sites keep working unchanged.
async function ensureAccountDetail(accountId) {
  const acct = state.accounts.find(a => a.id === accountId);
  if (!acct || acct._detailLoaded) return acct;
  try {
    const res = await fetch(`/api/accounts/${accountId}`);
    if (res.ok) {
      Object.assign(acct, await res.json());
    }
  } catch (err) {
    console.error('Failed to load account detail', err);
  }
  acct._detailLoaded = true; // don't retry on every re-selection even if the fetch failed
  return acct;
}

// Same idea for this account's posts/digests/jobs slice (see api.py's new
// GET /api/accounts/{id}/content) — main.js no longer bulk-fetches /api/content
// for every account up front.
async function ensureAccountContent(account) {
  if (state.contentLoadedAccountIds.has(account.id)) return;
  try {
    const res = await fetch(`/api/accounts/${account.id}/content`);
    if (res.ok) {
      const data = await res.json();
      Object.assign(state.contentStore.digests, data.digests || {});
      Object.assign(state.contentStore.posts, data.posts || {});
      Object.assign(state.contentStore.jobs, data.jobs || {});
    }
  } catch (err) {
    console.error('Failed to load account content', err);
  }
  state.contentLoadedAccountIds.add(account.id);
}

let selectionRequestId = 0;

// ── Data loading & Dynamic URL Endpoint Tracking ────────────
export function syncUrlState() {
  if (state.activeView === 'allJobs') {
    if (window.location.search !== '?view=jobs') {
      history.replaceState({ view: 'allJobs' }, '', `${window.location.pathname}?view=jobs`);
    }
    return;
  }
  if (!state.activeAccountId) {
    if (window.location.search) history.replaceState(null, '', window.location.pathname);
    return;
  }
  const params = new URLSearchParams();
  params.set('account', state.activeAccountId);
  if (state.activeLobId) params.set('lob', state.activeLobId);
  if (state.activeSalesTab) params.set('tab', state.activeSalesTab);
  const newQuery = `${window.location.pathname}?${params.toString()}`;
  if (window.location.search !== `?${params.toString()}`) {
    history.replaceState({ accountId: state.activeAccountId, lobId: state.activeLobId, tab: state.activeSalesTab }, '', newQuery);
  }
}

export function jumpToAccount(id) {
  state.expandedAccountIds.add(id);
  state.activeView = null;
  state.activeAccountId = id;
  state.activeLobId = null;
  renderNavTree();
  renderSelection();
}

export async function renderSelection() {
  closeContactDrawer();

  if (state.activeView === 'allJobs') {
    if (dashBody) dashBody.classList.add('no-account');
    if (dashPeople) { dashPeople.classList.add('d-none'); dashPeople.innerHTML = ''; }
    dashEmpty.classList.add('d-none');
    dashContent.classList.remove('d-none');
    dashContent.innerHTML = renderAllJobsPage();
    syncUrlState();
    return;
  }

  const account = state.accounts.find(a => a.id === state.activeAccountId);
  if (!account) {
    if (dashBody) dashBody.classList.add('no-account');
    if (dashPeople) dashPeople.classList.add('d-none');
    dashEmpty.classList.remove('d-none');
    dashContent.classList.add('d-none');
    if (dashPeople) dashPeople.innerHTML = '';
    renderDigest();
    syncUrlState();
    return;
  }

  if (dashBody) dashBody.classList.remove('no-account');
  if (dashPeople) dashPeople.classList.remove('d-none');
  dashEmpty.classList.add('d-none');
  dashContent.classList.remove('d-none');

  // Guards against a slow fetch from a previous selection clobbering a newer one
  // if the user switches accounts again before it resolves.
  const requestId = ++selectionRequestId;
  if (!account._detailLoaded) {
    dashContent.innerHTML = renderSkeleton('cards');
    dashPeople.innerHTML = '';
  }

  await Promise.all([ensureAccountDetail(account.id), ensureAccountContent(account)]);
  if (requestId !== selectionRequestId || state.activeAccountId !== account.id) return;

  const lob = state.activeLobId ? (account.lobs || []).find(l => l.id === state.activeLobId) : null;
  dashContent.innerHTML = renderCenter(account, lob);
  dashPeople.innerHTML = renderPeople(account, lob);
  syncUrlState();
  if (state.activeSalesTab === 'alerts') syncOpportunitySignals(account);
  if (state.activeSalesTab === 'weekly') syncWeeklyUpdate(account);
}

dashEmpty.addEventListener('click', function (e) {
  const viewAllJobsBtn = e.target.closest('#viewAllJobsBtn');
  if (viewAllJobsBtn) {
    openAllJobsPage();
    return;
  }

  const jumpBtn = e.target.closest('[data-jump-account]');
  if (jumpBtn) {
    jumpToAccount(Number(jumpBtn.dataset.jumpAccount));
  }
});

signalModalBody.addEventListener('click', function (e) {
  const jumpBtn = e.target.closest('[data-jump-account]');
  if (jumpBtn) {
    closeSignalModal();
    jumpToAccount(Number(jumpBtn.dataset.jumpAccount));
  }
});
