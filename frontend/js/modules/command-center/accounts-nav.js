// Left-column account navigator for the Command Center page — reuses the
// exact partials/nav.html markup (and nav.css) as the Global Accounts
// Dashboard so it looks and feels identical, but is intentionally NOT wired
// to nav-tree.js/selection.js: those render account detail inline into
// #dashContent/#dashPeople, which this page doesn't have. Here, picking an
// account just deep-links to the Global Accounts Dashboard for that account
// (index.html's main.js already supports ?account_key=<key>), so this stays
// self-contained instead of re-hosting the whole dashboard's render pipeline.
import { loadRealAccounts } from './real-accounts.js';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = (s == null ? '' : String(s));
  return d.innerHTML;
}
function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

let accounts = [];
let searchQuery = '';
let sortMode = 'score';

function el(id) { return document.getElementById(id); }

function applyFilters() {
  const q = searchQuery.trim().toLowerCase();
  let list = accounts.filter(a => {
    if (!q) return true;
    const text = `${a.name || ''} ${a.ticker || ''} ${a.legal_name || ''} ${(a.industries || []).join(' ')}`.toLowerCase();
    return text.includes(q);
  });
  list = [...list].sort((a, b) => {
    if (sortMode === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sortMode === 'contacts') {
      const cA = a.total_contacts_captured || (a.personas || []).length || 0;
      const cB = b.total_contacts_captured || (b.personas || []).length || 0;
      return cB - cA;
    }
    if (sortMode === 'recent') return new Date(b.extracted_at || 0) - new Date(a.extracted_at || 0);
    return (b.heat_score || 0) - (a.heat_score || 0); // 'score' (default)
  });
  return list;
}

function goToAccount(account) {
  const key = account.key || account.ticker || account.name;
  window.location.href = `/?account_key=${encodeURIComponent(key)}`;
}

function cardHtml(a) {
  const score = a.heat_score;
  const scoreClass = score >= 70 ? 'high' : (score >= 40 ? 'mid' : 'none');
  const scoreLabel = score != null ? `${score} SCORE` : '— SCORE';
  const contactsCount = a.total_contacts_captured || (a.personas || []).length || 0;
  const subtitle = [a.ticker ? `Ticker: ${a.ticker}` : '', (a.industries || [])[0] || ''].filter(Boolean).join(' · ') || (a.location || 'Enterprise');
  return `
    <div class="nav-account">
      <div class="nav-account-card" data-acct="${a.id}">
        <div class="nav-account-top">
          <span class="nav-account-avatar">${esc(initials(a.name))}</span>
          <span class="nav-account-name" title="${esc(a.name)}">${esc(a.name)}</span>
          <span class="nav-score-badge ${scoreClass}">${esc(scoreLabel)}</span>
        </div>
        <div class="nav-account-sub">${esc(subtitle)}</div>
        ${contactsCount ? `<div class="nav-account-tags"><span class="nav-micro-tag"><i class="bi bi-people-fill"></i> ${contactsCount} contacts</span></div>` : ''}
      </div>
    </div>`;
}

function render() {
  const list = applyFilters();
  const countEl = el('navAccountCount');
  if (countEl) countEl.textContent = `Accounts (${list.length})`;
  const tree = el('navTree');
  if (!tree) return;
  if (!list.length) {
    tree.innerHTML = '<div class="nav-empty"><i class="bi bi-search" style="font-size:1.4rem;"></i>No accounts match the current search.</div>';
    return;
  }
  tree.innerHTML = list.map(cardHtml).join('');
  tree.querySelectorAll('.nav-account-card').forEach(card => {
    card.addEventListener('click', () => {
      const account = accounts.find(a => a.id === Number(card.dataset.acct));
      if (account) goToAccount(account);
    });
  });
}

function markCurrentPage() {
  const ccLink = document.querySelector('.nav-digest-wrap a[href="/command-center"]');
  if (ccLink) ccLink.classList.add('active');
  const dashBtn = el('navDigestBtn');
  if (dashBtn) dashBtn.addEventListener('click', () => { window.location.href = '/'; });
}

export async function initAccountsNav() {
  markCurrentPage();
  // LOB drill-down isn't relevant here — this navigator only switches
  // accounts, so hide the expand/collapse-all control nav-tree.js otherwise offers.
  const toggleAllBtn = el('navToggleAllTree');
  if (toggleAllBtn) toggleAllBtn.style.display = 'none';

  const collapseBtn = el('navCollapseBtn');
  const dashNav = el('dashNav');
  const collapseIcon = el('navCollapseIcon');
  if (collapseBtn && dashNav) {
    collapseBtn.addEventListener('click', () => {
      const collapsed = dashNav.classList.toggle('is-collapsed');
      if (collapseIcon) collapseIcon.className = collapsed ? 'bi bi-layout-sidebar' : 'bi bi-layout-sidebar-reverse';
      collapseBtn.setAttribute('title', collapsed ? 'Expand navigator' : 'Collapse navigator');
    });
  }

  const searchInput = el('navSearch');
  const searchClear = el('navSearchClear');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value || '';
      if (searchClear) searchClear.classList.toggle('d-none', !searchQuery.trim());
      render();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      searchClear.classList.add('d-none');
      render();
    });
  }
  const sortSelect = el('navSortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      sortMode = sortSelect.value || 'score';
      render();
    });
  }

  const tree = el('navTree');
  try {
    accounts = await loadRealAccounts();
    render();
  } catch (err) {
    console.error(err);
    if (tree) tree.innerHTML = '<div class="nav-empty">Error loading accounts. Ensure the API is running.</div>';
  }
}
