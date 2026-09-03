// Standalone All-Jobs browser page (separate full-screen view, distinct from the
// per-account Jobs tab in account-tabs.js). Filters, sort, and pagination are all
// applied server-side (GET /api/linkedin-jobs) so the browser stays fast as the job
// dataset grows — the client never holds more than one page.
import { state } from './state.js';
import { el, dashContent } from './dom.js';
import { JOB_PAGE_SIZE } from './constants.js';
import { esc } from './utils.js';
import { renderJobCard } from './jobs.js';
import { renderSelection } from './selection.js';
import { renderNavTree } from './nav-tree.js';

export async function openAllJobsPage() {
  state.activeView = 'allJobs';
  state.activeAccountId = null;
  state.activeLobId = null;
  state.activeJobDetailId = null;
  state.activeJobCategory = 'All';
  state.activeJobSearch = '';
  state.activeJobEmploymentType = '';
  state.activeJobWorkplaceType = '';
  state.activeJobSort = 'newest';
  state.activeJobPage = 1;
  renderNavTree();
  renderSelection();
  await fetchAllJobs();
}

export async function fetchAllJobs(opts) {
  opts = opts || {};
  state.jobsLoading = true;
  if (state.activeView === 'allJobs') renderSelection();
  const params = new URLSearchParams();
  if (state.activeJobCategory !== 'All') params.set('category', state.activeJobCategory);
  if (state.activeJobSearch.trim()) params.set('q', state.activeJobSearch.trim());
  if (state.activeJobEmploymentType) params.set('employment_type', state.activeJobEmploymentType);
  if (state.activeJobWorkplaceType) params.set('workplace_type', state.activeJobWorkplaceType);
  params.set('sort', state.activeJobSort);
  params.set('page', String(state.activeJobPage));
  params.set('page_size', String(JOB_PAGE_SIZE));
  try {
    const res = await fetch(`/api/linkedin-jobs?${params.toString()}`);
    state.allJobsCache = await res.json();
  } catch (err) {
    state.allJobsCache = { total: 0, page: 1, page_size: JOB_PAGE_SIZE, total_pages: 1, categories: [], category_counts: {}, employment_types: [], workplace_types: [], jobs: [] };
  }
  state.jobsLoading = false;
  if (state.activeView === 'allJobs') {
    renderSelection();
    if (opts.focusSearch) {
      const input = el('jobSearchInput');
      if (input) {
        input.focus();
        const pos = input.value.length;
        input.setSelectionRange(pos, pos);
      }
    }
  }
}

export function renderAllJobsPage() {
  if (state.activeJobDetailId) return renderJobDetailPage();
  if (!state.allJobsCache) {
    return `<div class="panel"><div class="empty-block"><div class="empty-block-icon"><i class="bi bi-hourglass-split"></i></div><div class="empty-block-text">Loading job postings…</div></div></div>`;
  }
  const jobs = state.allJobsCache.jobs || [];
  const total = state.allJobsCache.total || 0;
  const totalPages = state.allJobsCache.total_pages || 1;
  const catCounts = state.allJobsCache.category_counts || {};
  const catTotal = Object.values(catCounts).reduce((s, n) => s + n, 0);
  const chips = ['All', ...(state.allJobsCache.categories || [])].map(c => {
    const count = c === 'All' ? catTotal : (catCounts[c] || 0);
    if (c !== 'All' && !count) return '';
    return `<button type="button" class="job-cat-chip ${state.activeJobCategory === c ? 'active' : ''}" data-job-category="${esc(c)}">${esc(c)} <span class="job-cat-count">${count}</span></button>`;
  }).join('');
  const employmentOptions = (state.allJobsCache.employment_types || []).map(t => `<option value="${esc(t)}" ${state.activeJobEmploymentType === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const workplaceOptions = (state.allJobsCache.workplace_types || []).map(t => `<option value="${esc(t)}" ${state.activeJobWorkplaceType === t ? 'selected' : ''}>${esc(t)}</option>`).join('');

  return `
    <button type="button" class="job-detail-back" id="jobsPageBackBtn"><i class="bi bi-arrow-left"></i> Back to Dashboard</button>
    <div class="panel" style="margin-bottom:12px;">
      <div class="digest-header">
        <h2 class="digest-title"><i class="bi bi-linkedin"></i> All LinkedIn Job Postings</h2>
        <p class="digest-sub">${total} job posting${total !== 1 ? 's' : ''} match your filters, scraped across every tracked account. Search, filter, or click any role for full details.</p>
      </div>
    </div>
    <div class="panel">
      <div class="job-browser-toolbar">
        <div class="job-search-wrap">
          <i class="bi bi-search"></i>
          <input type="text" id="jobSearchInput" placeholder="Search title, company, or location..." value="${esc(state.activeJobSearch)}" autocomplete="off">
        </div>
        <select id="jobEmploymentTypeFilter" class="job-filter-select" title="Filter by employment type">
          <option value="">All employment types</option>
          ${employmentOptions}
        </select>
        <select id="jobWorkplaceTypeFilter" class="job-filter-select" title="Filter by workplace type">
          <option value="">All workplace types</option>
          ${workplaceOptions}
        </select>
        <select id="jobSortSelect" class="job-filter-select" title="Sort order">
          <option value="newest" ${state.activeJobSort === 'newest' ? 'selected' : ''}>Newest first</option>
          <option value="applicants" ${state.activeJobSort === 'applicants' ? 'selected' : ''}>Most applicants</option>
          <option value="views" ${state.activeJobSort === 'views' ? 'selected' : ''}>Most views</option>
        </select>
      </div>
      <div class="job-browser-filters">${chips}</div>
      <div class="job-page-grid">
        ${state.jobsLoading ? `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-hourglass-split"></i></div><div class="empty-block-text">Loading…</div></div>`
          : (jobs.length ? jobs.map(j => renderJobBrowserCard(j)).join('') : `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-linkedin"></i></div><div class="empty-block-text">No job postings match your filters.</div></div>`)}
      </div>
      ${totalPages > 1 ? `
        <div class="job-pagination">
          <button type="button" class="job-page-btn" id="jobPrevPageBtn" ${state.activeJobPage <= 1 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i> Prev</button>
          <span class="job-page-status">Page ${state.allJobsCache.page} of ${totalPages}</span>
          <button type="button" class="job-page-btn" id="jobNextPageBtn" ${state.activeJobPage >= totalPages ? 'disabled' : ''}>Next <i class="bi bi-chevron-right"></i></button>
        </div>` : ''}
    </div>
  `;
}

export function renderJobDetailPage() {
  const cached = state.jobDetailCache[state.activeJobDetailId];
  return `
    <button type="button" class="job-detail-back" id="jobDetailBackBtn"><i class="bi bi-arrow-left"></i> Back to all job postings</button>
    <div class="panel">
      ${cached ? buildJobDetailHtml(cached) : `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-hourglass-split"></i></div><div class="empty-block-text">Loading job details…</div></div>`}
    </div>
  `;
}

export async function openJobDetail(jobId) {
  state.activeJobDetailId = jobId;
  renderSelection();
  if (state.jobDetailCache[jobId]) return;
  try {
    const res = await fetch(`/api/linkedin-jobs/${jobId}`);
    if (res.ok) state.jobDetailCache[jobId] = await res.json();
  } catch (err) { /* stays on the loading state; user can go back */ }
  if (state.activeJobDetailId === jobId) renderSelection();
}

export function renderJobBrowserCard(job) {
  return `
    <button type="button" class="job-browser-card" data-job-id="${job.id}">
      <div class="job-browser-account"><i class="bi bi-building"></i> ${esc(job.account_name || job.company_name || 'Unknown account')}</div>
      <div class="job-browser-title">${esc(job.title || 'Untitled role')}</div>
      <div class="job-browser-meta">
        ${job.location ? `<span><i class="bi bi-geo-alt"></i> ${esc(job.location)}</span>` : ''}
        ${job.category ? `<span class="pill pill-brand">${esc(job.category)}</span>` : ''}
        ${job.new_in_last_run ? '<span class="pill pill-success">New</span>' : ''}
      </div>
    </button>`;
}

export function buildJobDetailHtml(job) {
  return `
    ${renderJobCard(job, { showAccountLink: !!job.account_id, accountId: job.account_id, accountName: job.account_name })}
    ${job.description ? `<div class="job-detail-description">
      <div class="job-detail-description-title">Full description</div>
      ${job.description.split('\n').filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}
    </div>` : ''}
  `;
}

dashContent.addEventListener('click', function (e) {
  const detailBackBtn = e.target.closest('#jobDetailBackBtn');
  if (detailBackBtn) {
    state.activeJobDetailId = null;
    renderSelection();
    return;
  }
  const backBtn = e.target.closest('#jobsPageBackBtn');
  if (backBtn) {
    state.activeView = null;
    state.activeJobDetailId = null;
    renderNavTree();
    renderSelection();
    return;
  }
  const chip = e.target.closest('[data-job-category]');
  if (chip) {
    state.activeJobCategory = chip.dataset.jobCategory;
    state.activeJobPage = 1;
    fetchAllJobs();
    return;
  }
  const prevBtn = e.target.closest('#jobPrevPageBtn');
  if (prevBtn && !prevBtn.disabled) {
    state.activeJobPage = Math.max(1, state.activeJobPage - 1);
    fetchAllJobs();
    return;
  }
  const nextBtn = e.target.closest('#jobNextPageBtn');
  if (nextBtn && !nextBtn.disabled) {
    state.activeJobPage += 1;
    fetchAllJobs();
    return;
  }
  const card = e.target.closest('[data-job-id]');
  if (card) {
    openJobDetail(Number(card.dataset.jobId));
  }
});

dashContent.addEventListener('input', function (e) {
  if (e.target.id !== 'jobSearchInput') return;
  state.activeJobSearch = e.target.value;
  state.activeJobPage = 1;
  clearTimeout(state.jobSearchDebounceTimer);
  state.jobSearchDebounceTimer = setTimeout(() => fetchAllJobs({ focusSearch: true }), 350);
});

dashContent.addEventListener('change', function (e) {
  if (e.target.id === 'jobEmploymentTypeFilter') {
    state.activeJobEmploymentType = e.target.value;
  } else if (e.target.id === 'jobWorkplaceTypeFilter') {
    state.activeJobWorkplaceType = e.target.value;
  } else if (e.target.id === 'jobSortSelect') {
    state.activeJobSort = e.target.value;
  } else {
    return;
  }
  state.activeJobPage = 1;
  fetchAllJobs();
});
