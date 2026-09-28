// Shared LinkedIn-jobs engine. Used by digest.js (Global Recent Jobs), account-tabs.js
// (per-account Jobs tab), and jobs-browser.js (the standalone All-Jobs page).
import { state } from './state.js';
import { esc, formatJobSalary, formatWeekOf, resolveAccountTargetKey } from './utils.js';

export function getAccountJobs(account) {
  const key = resolveAccountTargetKey(account);
  return key ? (state.contentStore.jobs[key] || []) : [];
}

export function renderJobCard(job, opts) {
  opts = opts || {};
  const salaryText = formatJobSalary(job.salary);
  return `
    <div class="job-card">
      <div class="job-card-header">
        <div class="job-card-title-wrap">
          <div class="job-card-title">${esc(job.title || 'Untitled role')}</div>
          <div class="job-card-company"><i class="fa-solid fa-building"></i> ${esc(job.company_name || opts.accountName || '')}${job.location ? ` · ${esc(job.location)}` : ''}</div>
        </div>
        ${job.new_in_last_run ? '<span class="pill pill-success"><i class="fa-solid fa-star"></i> New</span>' : ''}
      </div>
      ${(job.employment_type || job.workplace_type || salaryText) ? `
        <div class="chip-row" style="margin:8px 0;">
          ${job.employment_type ? `<span class="chip">${esc(job.employment_type)}</span>` : ''}
          ${job.workplace_type ? `<span class="chip">${esc(job.workplace_type)}</span>` : ''}
          ${salaryText ? `<span class="chip"><i class="fa-solid fa-money-bill-wave"></i> ${esc(salaryText)}</span>` : ''}
        </div>` : ''}
      <div class="job-card-meta">
        ${job.posted_date ? `<span><i class="fa-solid fa-calendar-days"></i> Posted ${esc(formatWeekOf(job.posted_date))}</span>` : ''}
        ${job.applicants != null ? `<span><i class="fa-solid fa-users"></i> ${job.applicants} applicants</span>` : ''}
        ${job.views != null ? `<span><i class="fa-solid fa-eye"></i> ${job.views} views</span>` : ''}
      </div>
      <div class="job-card-actions">
        ${opts.showAccountLink ? `<button type="button" class="alert-view-account" data-jump-account="${opts.accountId}">Open ${esc(opts.accountName)} <i class="fa-solid fa-arrow-right"></i></button>` : ''}
        ${job.job_url ? `<a href="${esc(job.job_url)}" target="_blank" rel="noopener" class="job-card-link"><i class="fa-solid fa-arrow-up-right-from-square"></i> View posting</a>` : ''}
      </div>
    </div>`;
}
