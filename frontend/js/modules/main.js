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

initThemeToggle();

async function loadAccounts(user) {
  try {
    // Deep link: /?view=jobs opens the All Job Postings browser directly on load.
    const wantsJobsView = window.location.search === '?view=jobs';
    // Deep link from the content pipeline app (MERGE_PLAN.md Phase 3):
    // /?account_key=<key> opens that account, matched by its `key` column
    // since the linking app only knows the string key, not this app's
    // numeric account id.
    const deepLinkAccountKey = new URLSearchParams(window.location.search).get('account_key');
    // Any other query string (stale/unsupported) resets to a clean root URL on hard-refresh.
    if (window.location.search && !wantsJobsView && !deepLinkAccountKey) {
      history.replaceState(null, '', window.location.pathname);
    }

    // Note: /api/content (every post/job/digest for every account) is NOT fetched
    // here anymore — it's cross-account content, only needed by the digest's
    // social_digest/sales_alerts sections, and is fetched lazily by digest.js
    // the first time either of those sections scrolls into view (see
    // ensureBulkContentLoaded in digest.js). Per-account content is fetched
    // on demand when an account is selected (see ensureAccountContent in
    // selection.js).
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

    // The Global Accounts Dashboard is admin-granted, not default access —
    // a super_admin sees every account; anyone else only what's been
    // explicitly granted to them via UserAccountAccess (auth.py). A regular
    // user with zero grants has nothing to see here, so send them to the
    // page that IS open to everyone by default instead of an empty shell.
    if (user.role !== 'super_admin' && state.accounts.length === 0) {
      window.location.href = '/command-center?no_dashboard_access=1';
      return;
    }

    if (movementsRes && movementsRes.ok) {
      state.cxoMovementsStore = await movementsRes.json();
    }

    renderTopbarTicker();
    renderNavTree();
    const deepLinkAccount = deepLinkAccountKey && state.accounts.find(a => a.key === deepLinkAccountKey);
    if (wantsJobsView) {
      await openAllJobsPage();
    } else if (deepLinkAccount) {
      jumpToAccount(deepLinkAccount.id); // also corrects the URL to ?account=<id> via syncUrlState()
    } else {
      if (deepLinkAccountKey) history.replaceState(null, '', window.location.pathname); // unknown key — don't leave a dead link in the address bar
      renderDigest();
    }
  } catch (err) {
    console.error(err);
    navTree.innerHTML = '<div class="nav-empty">Error loading accounts. Ensure the API is running.</div>';
    dashEmpty.classList.add('digest-mode');
    dashEmpty.innerHTML = '<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-block-text">Could not load account data. Ensure the API server is running.</div></div>';
  }
}

// Account data is access-controlled server-side (see AUTH_JWT_IMPLEMENTATION_PLAN.md).
// Unauthenticated users are redirected to login. The Global Accounts Dashboard
// itself is admin-granted, not default access — see the redirect in
// loadAccounts() above for users with no granted accounts.
initTopbarAuth().then((user) => {
  if (!user) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return;
  }
  loadAccounts(user);
});
