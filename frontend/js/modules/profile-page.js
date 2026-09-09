// Entry point for the standalone full-page contact profile (opened via the
// contact drawer's "View Profile" button, see contact-drawer.js). Fetches
// its own account/persona/content data, renders the modular Bento-Grid dashboard,
// and wires interactive tabs, channel filtering, and feed pagination.
import './fetch-instrumentation.js'; // must load first — patches window.fetch to attach the bearer token
import { state } from './state.js';
import { el } from './dom.js';
import { renderFullProfile } from './full-profile.js';
import { wireProfilePdfDownload } from './contact-pdf.js';
import { renderPostCard } from './profile-render.js';
import { resolvePersonaTargetKey } from './utils.js';
import { refreshAccessToken } from './auth-client.js';

function setupSignalsPagination(container, posts) {
  const PAGE_SIZE = 12;
  const MAX_PAGES = 10;
  const MAX_ITEMS = PAGE_SIZE * MAX_PAGES; // Max 120 items across 10 pages
  let activeChannel = 'all';
  let currentPage = 1;

  function getFilteredPosts() {
    const pool = (activeChannel === 'all') ? posts : posts.filter(p => p.channel === activeChannel);
    return pool.slice(0, MAX_ITEMS);
  }

  function updateFeedAndPagination() {
    const feedContainer = container.querySelector('#profilePostFeed');
    const paginationContainer = container.querySelector('#profileFeedPagination');
    if (!feedContainer || !paginationContainer) return;

    const filtered = getFilteredPosts();
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, totalItems);
    const visiblePosts = filtered.slice(startIdx, endIdx);

    // Render cards for the current page
    if (visiblePosts.length) {
      feedContainer.innerHTML = visiblePosts.map(renderPostCard).join('');
    } else {
      feedContainer.innerHTML = `
        <div class="empty-block" style="grid-column: 1 / -1; padding: 24px 8px; text-align: center;">
          <div class="empty-block-text">No posts available for the selected filter.</div>
        </div>
      `;
    }

    // Render pagination controls
    if (totalItems <= PAGE_SIZE) {
      paginationContainer.innerHTML = `
        <div class="profile-pagination-info">Showing all ${totalItems} captured signal${totalItems !== 1 ? 's' : ''}</div>
        <div></div>
      `;
      return;
    }

    let pageBtns = '';
    for (let i = 1; i <= totalPages; i++) {
      pageBtns += `<button type="button" class="profile-page-nav-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    paginationContainer.innerHTML = `
      <div class="profile-pagination-info">Showing ${startIdx + 1}–${endIdx} of ${totalItems} captured signals (Page ${currentPage} of ${totalPages})</div>
      <div class="profile-pagination-controls">
        <button type="button" class="profile-page-nav-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>
          <i class="bi bi-chevron-left"></i> Prev
        </button>
        ${pageBtns}
        <button type="button" class="profile-page-nav-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>
          Next <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    `;
  }

  // Event listener for pagination & channel filtering
  container.addEventListener('click', (e) => {
    // 1. Channel Filter Click
    const filterPill = e.target.closest('.channel-filter-pill');
    if (filterPill) {
      const channel = filterPill.dataset.filter;
      if (channel) {
        activeChannel = channel;
        currentPage = 1;
        const bar = filterPill.closest('.channel-filters-bar');
        if (bar) {
          bar.querySelectorAll('.channel-filter-pill').forEach(p => p.classList.remove('active'));
        }
        filterPill.classList.add('active');
        updateFeedAndPagination();
      }
      return;
    }

    // 2. Pagination Nav Button Click
    const pageBtn = e.target.closest('.profile-page-nav-btn');
    if (pageBtn && !pageBtn.disabled) {
      const pageAction = pageBtn.dataset.page;
      const filtered = getFilteredPosts();
      const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

      if (pageAction === 'prev') {
        if (currentPage > 1) currentPage--;
      } else if (pageAction === 'next') {
        if (currentPage < totalPages) currentPage++;
      } else if (pageAction) {
        currentPage = parseInt(pageAction, 10);
      }

      updateFeedAndPagination();
      const feedSection = container.querySelector('#profilePostFeed');
      if (feedSection) {
        feedSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });

  // Initial render of pagination
  updateFeedAndPagination();
}

function wireInteractiveWidgets(container, persona) {
  // 1. Interactive Dossier Tab Switching
  container.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.profile-tab-btn');
    if (tabBtn) {
      const targetId = tabBtn.dataset.tabTarget;
      if (!targetId) return;

      const header = tabBtn.closest('.profile-tabs-header');
      if (header) {
        header.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.remove('active'));
      }
      tabBtn.classList.add('active');

      const parentWidget = tabBtn.closest('.profile-widget');
      if (parentWidget) {
        parentWidget.querySelectorAll('.profile-tab-pane').forEach(p => p.classList.remove('active'));
        const activePane = parentWidget.querySelector(`#${targetId}`);
        if (activePane) activePane.classList.add('active');
      }
    }
  });

  // 2. Feed Pagination and Channel Filtering
  const targetKey = resolvePersonaTargetKey(persona);
  const posts = targetKey ? (state.contentStore.posts[targetKey] || []) : [];
  if (posts.length) {
    setupSignalsPagination(container, posts);
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const accountId = parseInt(params.get('account'), 10);
  const personaId = parseInt(params.get('persona_id'), 10);
  const main = el('profilePageMain');
  const backLink = el('profilePageBack');

  if (!accountId || !personaId) {
    main.innerHTML = `<div class="profile-page-error">Missing or invalid link — this page needs both an account and a contact to show.</div>`;
    return;
  }

  backLink.href = `/?account=${encodeURIComponent(accountId)}`;

  await refreshAccessToken(); // this page opens in its own tab — restore the session from the refresh cookie first

  try {
    const [acctRes, contentRes] = await Promise.all([
      fetch(`/api/accounts/${accountId}`),
      fetch(`/api/accounts/${accountId}/content`).catch(() => null)
    ]);
    if (acctRes.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    if (acctRes.status === 403) {
      main.innerHTML = `<div class="profile-page-error">You don't have access to this account. Ask a super admin to grant it.</div>`;
      return;
    }
    if (!acctRes.ok) throw new Error(`Account fetch failed (${acctRes.status})`);
    const account = await acctRes.json();

    if (contentRes && contentRes.ok) {
      const content = await contentRes.json();
      Object.assign(state.contentStore.digests, content.digests || {});
      Object.assign(state.contentStore.posts, content.posts || {});
      Object.assign(state.contentStore.jobs, content.jobs || {});
    }

    const persona = (account.personas || []).find(p => p.id === personaId);
    if (!persona) {
      main.innerHTML = `<div class="profile-page-error">This contact could not be found on ${account.name || 'this account'} — they may have been removed or merged since this link was created.</div>`;
      return;
    }

    persona.company_name = account.name || '';

    document.title = `${persona.name || 'Contact'} — Executive Profile`;
    el('profilePageTitle').textContent = document.title;

    state.activeAccountId = accountId;
    main.innerHTML = renderFullProfile(persona);
    wireInteractiveWidgets(main, persona);
    wireProfilePdfDownload(main, persona);
  } catch (err) {
    console.error('Failed to load contact profile', err);
    main.innerHTML = `<div class="profile-page-error">Could not load this profile — ${err.message}. Try reopening it from the dashboard.</div>`;
  }
}

init();
