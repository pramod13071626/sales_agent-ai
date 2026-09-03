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

initThemeToggle();

async function loadAccounts() {
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

    const [acctRes, contentRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/content').catch(() => null)
    ]);
    if (!acctRes.ok) throw new Error('Failed to load accounts');
    const data = await acctRes.json();
    state.accounts = data.accounts || [];

    if (contentRes && contentRes.ok) {
      state.contentStore = await contentRes.json();
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

loadAccounts();
