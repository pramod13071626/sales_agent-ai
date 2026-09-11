// Entry point. fetch-instrumentation must be imported first (for its side effect —
// patching window.fetch — before any other module's code can call fetch). Every other
// module gets pulled into the graph transitively via the imports below; ES modules
// evaluate each file exactly once regardless of how many places import it.
import './fetch-instrumentation.js';

import { state } from './state.js';
import { navTree, dashEmpty } from './dom.js';
import { initThemeToggle } from './theme.js';
import { renderTopbarTicker } from './topbar.js';
import { renderNavTree } from './nav-tree.js';
import { renderDigest } from './digest.js';
import { jumpToAccount } from './selection.js';
import { openAllJobsPage } from './jobs-browser.js';
import { initTopbarAuth } from './topbar-auth.js';
import { showToast } from './toast.js';

initThemeToggle();

async function loadAccounts(user) {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const wantsJobsView = searchParams.get('view') === 'jobs';
    const deepLinkAccountId = searchParams.get('account') ? parseInt(searchParams.get('account'), 10) : null;
    const deepLinkAccountKey = searchParams.get('account_key');
    const deepLinkTab = searchParams.get('tab');
    const deepLinkLobId = searchParams.get('lob') ? parseInt(searchParams.get('lob'), 10) : null;
    const wantsCcAccessNotice = searchParams.get('no_command_center_access') === '1';

    if (wantsCcAccessNotice) {
      showToast("You don't have Sales Command Center access — ask a super admin to grant it.");
      history.replaceState(null, '', window.location.pathname);
    }

    // Fetch accounts and cxo movements
    const [acctRes, movementsRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/cxo-movements').catch(() => null)
    ]);
    if (acctRes.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    if (!acctRes.ok) throw new Error('Failed to load accounts');
    const data = await acctRes.json();
    state.accounts = data.accounts || [];

    // Only redirect away from this page if the user has NO assigned accounts
    // AND has global dashboard access revoked. If they have assigned accounts,
    // they can stay to view their account dossiers!
    if (user.role !== 'super_admin' && user.has_dashboard_access === false && state.accounts.length === 0) {
      if (user.has_command_center_access !== false) {
        window.location.href = '/command-center?no_dashboard_access=1';
        return;
      } else if (user.has_tasks_access !== false) {
        window.location.href = '/tasks?no_dashboard_access=1';
        return;
      } else {
        // No dashboards enabled: render in-place message, do not redirect in a loop
        navTree.innerHTML = '<div class="nav-empty" style="padding:20px; text-align:center;"><i class="bi bi-shield-lock" style="font-size:1.5rem; display:block; margin-bottom:8px;"></i>No accounts assigned yet.</div>';
        dashEmpty.classList.add('digest-mode');
        dashEmpty.innerHTML = `
          <div class="empty-block" style="margin:40px auto; max-width:440px; text-align:center; padding:32px;">
            <div class="empty-block-icon" style="font-size:2.5rem; color:var(--text-muted); margin-bottom:12px;"><i class="bi bi-shield-lock"></i></div>
            <div style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin-bottom:8px;">Account Access Required</div>
            <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5;">You do not currently have any assigned company accounts or dashboard permissions. Ask your Super Administrator to grant you access.</div>
          </div>`;
        return;
      }
    }

    if (movementsRes && movementsRes.ok) {
      state.cxoMovementsStore = await movementsRes.json();
    }

    renderTopbarTicker();
    renderNavTree();

    const targetAccount = deepLinkAccountId
      ? state.accounts.find(a => a.id === deepLinkAccountId)
      : (deepLinkAccountKey ? state.accounts.find(a => a.key === deepLinkAccountKey) : null);

    if (wantsJobsView) {
      if (user.role !== 'super_admin' && user.has_dashboard_access === false) {
        // User has no global cross-account jobs browser access: jump to account-specific jobs tab
        const acctToOpen = targetAccount || state.accounts[0];
        if (acctToOpen) {
          state.activeSalesTab = 'jobs';
          jumpToAccount(acctToOpen.id);
        } else {
          renderNavTree();
        }
      } else {
        await openAllJobsPage();
      }
    } else {
      if (targetAccount) {
        if (deepLinkTab) state.activeSalesTab = deepLinkTab;
        if (deepLinkLobId) state.activeLobId = deepLinkLobId;
        jumpToAccount(targetAccount.id);
      } else if (user.role !== 'super_admin' && user.has_dashboard_access === false) {
        // User has no global digest access, but has assigned accounts: default to their first account dossier
        if (deepLinkTab) state.activeSalesTab = deepLinkTab;
        if (state.accounts.length > 0) {
          jumpToAccount(state.accounts[0].id);
        } else {
          renderNavTree();
        }
      } else {
        if (deepLinkAccountKey || deepLinkAccountId) {
          history.replaceState(null, '', window.location.pathname);
        }
        renderDigest();
      }
    }
  } catch (err) {
    console.error(err);
    navTree.innerHTML = '<div class="nav-empty">Error loading accounts. Ensure the API is running.</div>';
    dashEmpty.classList.add('digest-mode');
    dashEmpty.innerHTML = '<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-block-text">Could not load account data. Ensure the API server is running.</div></div>';
  }
}

// Account data is access-controlled server-side.
// Unauthenticated users are redirected to login.
initTopbarAuth().then((user) => {
  if (!user) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return;
  }
  // Hide quick-jump nav links for dashboards the user has had revoked
  if (user.role !== 'super_admin') {
    if (user.has_dashboard_access === false) {
      const dashBtn = document.getElementById('navDigestBtn');
      if (dashBtn) dashBtn.style.display = 'none';
    }
    if (user.has_command_center_access === false) {
      const ccLink = document.querySelector('.nav-digest-wrap a[href="/command-center"]');
      if (ccLink) ccLink.style.display = 'none';
    }
    if (user.has_tasks_access === false) {
      const tasksLink = document.querySelector('.nav-digest-wrap a[href="/tasks"]');
      if (tasksLink) tasksLink.style.display = 'none';
    }
  }
  loadAccounts(user);
});
