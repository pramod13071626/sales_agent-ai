// Hiring-surge widget — real LinkedIn job postings (GET /api/linkedin-jobs,
// same global/unauth endpoint the Global Accounts Dashboard's job browser
// uses), grouped by account and restricted to the last 30 days. A spike in
// postings (esp. multiple roles at once) is a real buying signal a rep
// should notice without opening each account's Jobs tab individually.
import { loadMatrixAccounts } from './real-accounts.js';
import { openDossier } from './drawer.js';
import { esc } from './utils.js';

let rawJobsPromise = null;

function loadRawJobs() {
  if (!rawJobsPromise) {
    rawJobsPromise = fetch('/api/linkedin-jobs?sort=newest&page_size=100')
      .then(res => { if (!res.ok) throw new Error(`Failed to load job postings (${res.status})`); return res.json(); })
      .then(data => data.jobs || []);
  }
  return rawJobsPromise;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/\b(the|corporation|corp|inc|llc|ltd|company|co|group)\b/g, '').replace(/[^a-z0-9]+/g, '');
}

async function loadHiringSignals() {
  const [jobs, accounts] = await Promise.all([loadRawJobs(), loadMatrixAccounts()]);
  const byId = new Map(accounts.map(a => [a.id, a]));
  const byName = new Map(accounts.map(a => [normalize(a.name), a]));
  const cutoff = Date.now() - 30 * 86400000;

  const byAccount = new Map(); // account.id -> { account, jobs: [] }
  for (const j of jobs) {
    if (!j.first_seen) continue;
    const seenAt = new Date(j.first_seen);
    if (isNaN(seenAt.getTime()) || seenAt.getTime() < cutoff) continue;
    const account = (j.account_id != null && byId.get(j.account_id)) || byName.get(normalize(j.company_name || j.account_name));
    if (!account) continue; // not one of your accounts — skip rather than guess
    if (!byAccount.has(account.id)) byAccount.set(account.id, { account, jobs: [] });
    byAccount.get(account.id).jobs.push({ ...j, _date: seenAt });
  }

  return [...byAccount.values()]
    .map(({ account, jobs }) => ({ account, jobs: jobs.sort((a, b) => b._date - a._date), count: jobs.length }))
    .sort((a, b) => b.count - a.count);
}

function rowHtml(entry) {
  const { account, jobs, count } = entry;
  const sample = jobs.slice(0, 2).map(j => j.title).filter(Boolean).join(' · ') || 'New roles posted';
  return `
    <li class="cc-feed-row cc-clickable-row" data-account-id="${account.id}">
      <div class="cc-feed-body">
        <div class="cc-feed-title-row">
          <span class="cc-feed-title">${esc(account.name)}</span>
          ${count >= 3 ? '<span class="cc-badge cc-badge-warning">hiring surge</span>' : ''}
        </div>
        <div class="cc-feed-summary">${esc(sample)}</div>
      </div>
      <div class="cc-feed-count">${count} role${count === 1 ? '' : 's'}</div>
    </li>`;
}

export async function renderHiringSignals() {
  const list = document.getElementById('ccHiringList');
  if (!list) return;
  list.innerHTML = '<li class="cc-drawer-empty">Loading hiring signals…</li>';
  let entries;
  try {
    entries = await loadHiringSignals();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load job postings.</li>';
    return;
  }
  if (!entries.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No new job postings in the last 30 days for your accounts.</li>';
    return;
  }
  list.innerHTML = entries.map(rowHtml).join('');
  list.querySelectorAll('.cc-clickable-row').forEach(row => {
    row.addEventListener('click', () => {
      const entry = entries.find(e => String(e.account.id) === row.dataset.accountId);
      if (entry) openDossier(entry.account);
    });
  });
}
