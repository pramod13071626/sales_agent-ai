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

export function renderSelection() {
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
  const lob = state.activeLobId ? (account.lobs || []).find(l => l.id === state.activeLobId) : null;

  if (dashBody) dashBody.classList.remove('no-account');
  if (dashPeople) dashPeople.classList.remove('d-none');
  dashEmpty.classList.add('d-none');
  dashContent.classList.remove('d-none');
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
