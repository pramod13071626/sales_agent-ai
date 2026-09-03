// Cross-account "no account selected" overview screen. Six of its seven sections
// (everything except the static step_guide) are lazy-rendered via IntersectionObserver:
// renderDigest() builds the shell + skeleton placeholders synchronously (cheap), then
// each section's real content is computed only once it scrolls into view.
import { state } from './state.js';
import { dashEmpty, el } from './dom.js';
import { DIGEST_SECTIONS } from './constants.js';
import { esc, timeAgo, isDryRunDigest, resolveAccountTargetKey, resolvePersonaTargetKey } from './utils.js';
import { showToast } from './toast.js';
import { getAccountContentEntries, matchOfferings, renderAlertCards } from './alerts.js';
import { computeDomainExpansionOpportunities } from './opportunities.js';
import { renderJobCard } from './jobs.js';
import { renderSkeleton } from './skeleton.js';

// social_digest and sales_alerts are the only digest sections that genuinely need
// real full-text posts/digests across every account (keyword/theme matching over
// actual content) — everything else renders from the account summaries already in
// state.accounts. Rather than main.js bulk-fetching /api/content for every account
// on every page load, it's fetched here, once, the first time either of those two
// sections actually scrolls into view (see the `prefetch` hook in SECTION_RENDERERS
// and renderSection below).
let bulkContentPromise = null;
function ensureBulkContentLoaded() {
  if (state.bulkContentLoaded) return Promise.resolve();
  if (!bulkContentPromise) {
    bulkContentPromise = fetch('/api/content')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          Object.assign(state.contentStore.digests, data.digests || {});
          Object.assign(state.contentStore.posts, data.posts || {});
          Object.assign(state.contentStore.jobs, data.jobs || {});
        }
      })
      .catch(err => console.error('Failed to load cross-account content', err))
      .finally(() => { state.bulkContentLoaded = true; });
  }
  return bulkContentPromise;
}

// linkedin_jobs needs recent postings across every account, but never full
// description text — GET /api/linkedin-jobs is already exactly this (lean summary
// dicts with account_id/account_name embedded, server-side sorted/paginated), so
// this section sources from it directly instead of the bulk content fetch above.
let recentJobsCache = null;
async function ensureRecentJobsLoaded() {
  if (recentJobsCache) return;
  try {
    const res = await fetch('/api/linkedin-jobs?sort=newest&page_size=8');
    recentJobsCache = res.ok ? ((await res.json()).jobs || []) : [];
  } catch (err) {
    console.error('Failed to load recent jobs', err);
    recentJobsCache = [];
  }
}

function saveDigestSectionVisibility() {
  try {
    localStorage.setItem('dash_digest_section_visibility', JSON.stringify(state.digestSectionVisibility));
  } catch (e) {
    console.warn('Could not save digest section visibility to localStorage', e);
  }
}

// ── Section body renderers (each returns just the inner content for its panel,
// deferred behind a skeleton until its container scrolls into view) ──

function renderRecentlyUpdatedBody() {
  const recentlyUpdated = [...state.accounts]
    .filter(a => a.extracted_at)
    .sort((a, b) => new Date(b.extracted_at) - new Date(a.extracted_at))
    .slice(0, 6);
  if (!recentlyUpdated.length) {
    return '<div class="empty-block" style="padding:10px 0;"><div class="empty-block-text">No extraction timestamps recorded yet.</div></div>';
  }
  return recentlyUpdated.map(a => `
    <button type="button" class="digest-list-row clickable" data-jump-account="${a.id}" title="Click to open ${esc(a.name)}">
      <span class="digest-list-name"><i class="bi bi-building"></i> ${esc(a.name)}</span>
      <span class="digest-list-meta">${esc(timeAgo(a.extracted_at))} <i class="bi bi-chevron-right"></i></span>
    </button>`).join('');
}

function renderMostMappedBody() {
  const topByContacts = [...state.accounts]
    .sort((a, b) => (b.total_contacts_captured || 0) - (a.total_contacts_captured || 0))
    .slice(0, 6);
  if (!topByContacts.length) return '';
  return topByContacts.map(a => `
    <button type="button" class="digest-list-row clickable" data-jump-account="${a.id}" title="Click to open ${esc(a.name)}">
      <span class="digest-list-name"><i class="bi bi-building"></i> ${esc(a.name)}</span>
      <span class="digest-list-meta">${a.total_contacts_captured || 0} contacts <i class="bi bi-chevron-right"></i></span>
    </button>`).join('');
}

// Digest-only — no per-account equivalent (private, per the Revealing Module Pattern:
// only exported what other modules actually need).
function renderContentDigestSummary() {
  const digests = state.contentStore.digests || {};
  const posts = state.contentStore.posts || {};
  const allKeys = new Set([...Object.keys(digests), ...Object.keys(posts)].filter(k => k !== 'example_co'));

  if (!allKeys.size) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-inbox"></i></div>
      <div class="empty-block-text">No content intelligence captured yet for any account. This needs a content-crawling + LLM-analysis step to populate.</div>
    </div>`;
  }

  const totalPosts = [...allKeys].reduce((s, k) => s + (posts[k] || []).length, 0);
  const realDigestCount = [...allKeys].filter(k => !isDryRunDigest(digests[k])).length;

  const matchedKeys = new Set();
  const readyAccounts = [];
  state.accounts.forEach(a => {
    const key = resolveAccountTargetKey(a);
    if (key && allKeys.has(key)) {
      matchedKeys.add(key);
      const d = digests[key];
      readyAccounts.push({
        account: a, key,
        dryRun: isDryRunDigest(d),
        channelCount: d ? (d.digest.channels || []).length : 0,
        postCount: (posts[key] || []).length
      });
    }
  });

  let personaPostCount = 0;
  state.accounts.forEach(a => {
    (a.personas || []).forEach(p => {
      const key = resolvePersonaTargetKey(p);
      if (key) { matchedKeys.add(key); personaPostCount += (posts[key] || []).length; }
    });
  });

  const orphanKeys = [...allKeys].filter(k => !matchedKeys.has(k));

  return `
    <div class="chip-row" style="margin-bottom:12px;">
      <span class="chip"><i class="bi bi-collection"></i> ${totalPosts} posts captured</span>
      <span class="chip"><i class="bi bi-stars"></i> ${realDigestCount} real digest${realDigestCount !== 1 ? 's' : ''} ready</span>
      ${personaPostCount ? `<span class="chip"><i class="bi bi-person-lines-fill"></i> ${personaPostCount} posts on mapped contacts</span>` : ''}
    </div>

    ${readyAccounts.length ? readyAccounts.map(r => `
      <button type="button" class="digest-list-row clickable" data-jump-account="${r.account.id}">
        <span class="digest-list-name">${esc(r.account.name)}</span>
        <span class="digest-list-meta">${r.dryRun ? `${r.postCount} posts (digest pending)` : `${r.channelCount} channels analyzed · ${r.postCount} posts`}</span>
      </button>`).join('') : ''}

    ${orphanKeys.length ? `
      <div class="content-provenance" style="margin-top:12px;"><i class="bi bi-info-circle"></i> Captured but not a tracked account yet — run the pipeline for these to unlock full analysis:</div>
      <div class="chip-row" style="margin-top:6px;">
        ${orphanKeys.map(k => `<span class="chip"><i class="bi bi-building"></i> ${esc((digests[k] && digests[k].digest.company) || k)} — ${(posts[k] || []).length} posts</span>`).join('')}
      </div>` : ''}
  `;
}

function renderGlobalSalesAlertsBody() {
  let entries = [];
  state.accounts.forEach(a => {
    const acctEntries = getAccountContentEntries(a).map(e => ({ ...e, account: a.name, accountId: a.id }));
    entries = entries.concat(acctEntries);
  });
  if (!entries.length) {
    return renderAlertCards([], { emptyText: 'No captured content yet across any account to match against StradIT’s service lines.' });
  }
  const matches = matchOfferings(entries).map(m => ({
    ...m,
    accountIds: entries.filter(e => m.keywords.some(rx => rx.test(e.text))).map(e => e.accountId)
  }));
  return renderAlertCards(matches, {
    emptyText: 'Captured content doesn’t reference any StradIT service line yet across your accounts.',
    getAccount: (m) => state.accounts.find(a => a.id === m.evidence.accountId)
  });
}

function renderGlobalDomainExpansionBody() {
  const rows = [];
  state.accounts.forEach(a => {
    computeDomainExpansionOpportunities(a).forEach(o => rows.push({ account: a, opportunity: o }));
  });
  if (!rows.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-layers"></i></div>
      <div class="empty-block-text">No emerging domain-expansion opportunities detected yet across any account.</div>
    </div>`;
  }
  return rows.map(({ account, opportunity: o }) => `
    <div class="opportunity-card opportunity-card-brand">
      <div class="opportunity-header">
        <i class="bi ${esc(o.icon || 'bi-layers')}"></i>
        <span class="opportunity-title">${esc(o.title)}</span>
        ${o.status ? `<span class="pill ${esc(o.statusClass || 'pill-brand')}">${esc(o.status)}</span>` : ''}
      </div>
      ${o.domain ? `<div class="opportunity-note"><strong>${esc(o.domain)}</strong>${o.demandSignal ? ` — ${esc(o.demandSignal)}` : ''}</div>` : ''}
      ${o.proposedScope ? `<div class="opportunity-idea"><i class="bi bi-lightbulb"></i> <strong>Suggested build:</strong> ${esc(o.proposedScope)}</div>` : ''}
      <button type="button" class="alert-view-account" data-jump-account="${account.id}">Open ${esc(account.name)} <i class="bi bi-arrow-right"></i></button>
    </div>`).join('');
}

function renderGlobalRecentJobsBody() {
  const rows = [];
  state.accounts.forEach(a => {
    getAccountJobs(a).forEach(j => rows.push({ account: a, job: j }));
  });
  rows.sort((x, y) => new Date(y.job.first_seen || y.job.posted_date || 0) - new Date(x.job.first_seen || x.job.posted_date || 0));
  const top = rows.slice(0, 8);
  if (!top.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-linkedin"></i></div>
      <div class="empty-block-text">No LinkedIn job postings captured yet across any account.</div>
    </div>`;
  }
  return top.map(({ account, job }) => renderJobCard(job, { showAccountLink: true, accountId: account.id, accountName: account.name })).join('')
    + '<button type="button" class="alert-view-account" id="viewAllJobsBtn" style="margin-top:12px;"><i class="bi bi-grid-3x3-gap"></i> View All Job Postings</button>';
}

// Ported from dev's feature-cxo-pipline branch (originally inline in the pre-refactor
// dashboard.js). Data is fetched once, upfront, alongside contentStore (see main.js) —
// switching tabs re-renders the whole digest via renderDigest(), same as the
// customize-menu hide/show actions, so no separate lazy-fetch is needed here.
function renderCxoMovementsBody() {
  const movements = state.cxoMovementsStore.movements || [];
  const counts = state.cxoMovementsStore.counts || { all: movements.length, joined: 0, resigned: 0, retired: 0, promoted: 0 };

  let filtered = movements;
  if (state.activeMovementTab !== 'all') {
    filtered = filtered.filter(m => (m.event_type || '').toLowerCase() === state.activeMovementTab);
  }

  const tabs = [
    { id: 'all', label: 'All', icon: 'bi-arrow-left-right', count: counts.all || movements.length },
    { id: 'joined', label: 'Joined', icon: 'bi-person-plus-fill', count: counts.joined || 0 },
    { id: 'resigned', label: 'Resigned', icon: 'bi-person-dash-fill', count: counts.resigned || 0 },
    { id: 'retired', label: 'Retired', icon: 'bi-clock-history', count: counts.retired || 0 },
    { id: 'promoted', label: 'Promoted', icon: 'bi-arrow-up-circle-fill', count: counts.promoted || 0 }
  ].map(t => `
    <button type="button" class="tab-btn ${state.activeMovementTab === t.id ? 'active' : ''}" data-movement-tab="${t.id}" style="padding:6px 10px; font-size:.74rem;">
      <i class="bi ${t.icon}"></i> ${esc(t.label)} <span class="tab-badge">${t.count}</span>
    </button>
  `).join('');

  const cards = filtered.length ? `
    <div class="movement-grid" style="max-height:580px; overflow-y:auto; padding-right:4px; grid-template-columns:1fr; gap:10px;">
      ${filtered.map(m => {
        const evt = (m.event_type || 'joined').toLowerCase();
        const evtLabel = evt === 'joined' ? '🟢 Joined' : (evt === 'resigned' ? '🔴 Resigned' : (evt === 'retired' ? '🟡 Retired' : '🔵 Promoted'));
        return `
          <div class="movement-card event-${evt}">
            <div>
              <div class="movement-card-header">
                <div>
                  <div class="movement-person">${esc(m.person_name)}</div>
                  <div class="movement-designation">${esc(m.designation || 'Executive Leadership')}</div>
                </div>
                <span class="movement-badge ${evt}">${evtLabel}</span>
              </div>

              <div class="movement-meta-row">
                <div class="movement-meta-item">
                  <i class="bi bi-building"></i>
                  <span><strong>Company:</strong> ${esc(m.company_name)}</span>
                  ${m.account_id ? `<button type="button" class="cxo-company-btn" data-jump-account="${m.account_id}" style="margin-left:4px; font-size:.65rem; padding:1px 5px;">View Org <i class="bi bi-arrow-right"></i></button>` : ''}
                </div>
                ${m.effective_date ? `
                  <div class="movement-meta-item">
                    <i class="bi bi-calendar3"></i>
                    <span><strong>Timing / Date:</strong> ${esc(m.effective_date)}</span>
                  </div>` : ''}
                ${m.previous_role ? `
                  <div class="movement-meta-item">
                    <i class="bi bi-briefcase"></i>
                    <span><strong>Previous Role / Tenure:</strong> ${esc(m.previous_role)}</span>
                  </div>` : ''}
                ${m.new_company ? `
                  <div class="movement-meta-item">
                    <i class="bi bi-box-arrow-up-right"></i>
                    <span><strong>New Organization:</strong> ${esc(m.new_company)}</span>
                  </div>` : ''}
              </div>

              ${m.context ? `<div class="movement-context">${esc(m.context)}</div>` : ''}
            </div>

            <div class="movement-footer">
              <span class="movement-source"><i class="bi bi-newspaper"></i> ${esc(m.source || m.publisher_domain || 'News Wire')}</span>
              ${m.article_url ? `<a href="${esc(m.article_url)}" target="_blank" class="movement-link">Source Article <i class="bi bi-box-arrow-up-right"></i></a>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : `
    <div class="empty-block" style="padding:20px 10px; text-align:center;">
      <div class="empty-block-icon" style="font-size:1.6rem; color:var(--text-muted); margin-bottom:6px;"><i class="bi bi-arrow-left-right"></i></div>
      <div style="font-weight:700; font-size:.88rem; color:var(--text-primary); margin-bottom:4px;">No movements in this category</div>
      <div style="font-size:.76rem; color:var(--text-secondary);">Transitions will appear here when executive appointments or departures occur.</div>
    </div>
  `;

  return `<div class="sales-tabs" style="margin-bottom:12px; border-bottom:1px solid var(--border-color); gap:3px;">${tabs}</div>${cards}`;
}

// id -> { render: () => htmlString, skeleton: 'cards'|'list-rows'|'lines' }
const SECTION_RENDERERS = {
  recently_updated: { render: renderRecentlyUpdatedBody, skeleton: 'cards' },
  most_mapped: { render: renderMostMappedBody, skeleton: 'cards' },
  social_digest: { render: renderContentDigestSummary, skeleton: 'lines' },
  sales_alerts: { render: renderGlobalSalesAlertsBody, skeleton: 'list-rows' },
  domain_expansion: { render: renderGlobalDomainExpansionBody, skeleton: 'list-rows' },
  cxo_movements: { render: renderCxoMovementsBody, skeleton: 'list-rows' },
  linkedin_jobs: { render: renderGlobalRecentJobsBody, skeleton: 'cards' },
};

let observer = null;

function renderSection(container) {
  const sectionId = container.dataset.sectionId;
  const entry = SECTION_RENDERERS[sectionId];
  if (!entry) return;
  try {
    container.innerHTML = entry.render();
  } catch (err) {
    console.error(`Digest section "${sectionId}" failed to render`, err);
    container.innerHTML = `
      <div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-exclamation-triangle"></i></div>
        <div class="empty-block-text">Couldn't render this section.</div>
        <button type="button" class="alert-view-account" data-retry-section="${sectionId}" style="margin-top:10px;">
          <i class="bi bi-arrow-clockwise"></i> Retry
        </button>
      </div>`;
  }
}

function observeDigestSections() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      renderSection(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '150px 0px', threshold: 0 });

  dashEmpty.querySelectorAll('.digest-section-body[data-section-id]').forEach(el => observer.observe(el));
}

dashEmpty.addEventListener('click', function (e) {
  const retryBtn = e.target.closest('[data-retry-section]');
  if (retryBtn) {
    const container = retryBtn.closest('.digest-section-body');
    if (container) renderSection(container);
    return;
  }

  const movTabBtn = e.target.closest('[data-movement-tab]');
  if (movTabBtn) {
    state.activeMovementTab = movTabBtn.dataset.movementTab;
    renderDigest();
  }
});

function sectionBody(sectionId) {
  const entry = SECTION_RENDERERS[sectionId];
  return `<div class="digest-section-body" data-section-id="${sectionId}">${renderSkeleton(entry ? entry.skeleton : 'cards')}</div>`;
}

export function renderDigest() {
  dashEmpty.classList.add('digest-mode');

  if (!state.accounts.length) {
    dashEmpty.innerHTML = `
      <div class="dash-empty-icon"><i class="bi bi-building"></i></div>
      <p class="dash-empty-title">No accounts yet</p>
      <p class="dash-empty-sub">Run the pipeline to populate your first account, then select it from the left panel.</p>`;
    dashEmpty.classList.remove('digest-mode');
    return;
  }

  const visibleCount = DIGEST_SECTIONS.filter(s => state.digestSectionVisibility[s.id] !== false).length;

  const showStepGuide = state.digestSectionVisibility.step_guide !== false;
  const showRecent = state.digestSectionVisibility.recently_updated !== false;
  const showMapped = state.digestSectionVisibility.most_mapped !== false;
  const showSocial = state.digestSectionVisibility.social_digest !== false;
  const showAlerts = state.digestSectionVisibility.sales_alerts !== false;
  const showDomain = state.digestSectionVisibility.domain_expansion !== false;
  const showCxoMovements = state.digestSectionVisibility.cxo_movements !== false;
  const showJobs = state.digestSectionVisibility.linkedin_jobs !== false;

  let topAccountsHtml = '';
  if (showRecent || showMapped) {
    const gridClass = (showRecent && showMapped) ? 'digest-grid-2' : 'digest-grid-1';
    topAccountsHtml = `
      <div class="${gridClass}">
        ${showRecent ? `
          <div class="panel">
            <div class="panel-title">
              <span><i class="bi bi-clock-history"></i> Recently Updated Accounts</span>
              <div class="panel-title-tools">
                <span class="context-badge live"><i class="bi bi-arrow-repeat"></i> Fresh Scrapes</span>
                <button type="button" class="panel-hide-btn" data-hide-section="recently_updated" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
              </div>
            </div>
            <p class="section-desc">Accounts with the most recent pipeline updates, data enrichments, or fresh signal captures.</p>
            ${sectionBody('recently_updated')}
          </div>
        ` : ''}

        ${showMapped ? `
          <div class="panel">
            <div class="panel-title">
              <span><i class="bi bi-people-fill"></i> Most-Mapped Accounts</span>
              <div class="panel-title-tools">
                <span class="context-badge live"><i class="bi bi-check2-all"></i> Org Coverage</span>
                <button type="button" class="panel-hide-btn" data-hide-section="most_mapped" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
              </div>
            </div>
            <p class="section-desc">Accounts with the deepest organizational charts and highest volume of executive contacts identified.</p>
            ${sectionBody('most_mapped')}
          </div>
        ` : ''}
      </div>
    `;
  }

  let socialHtml = '';
  if (showSocial) {
    socialHtml = `
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-broadcast-pin"></i> Social &amp; Content Intelligence Digest</span>
          <div class="panel-title-tools">
            <span class="context-badge ai"><i class="bi bi-stars"></i> Cross-Account AI</span>
            <button type="button" class="panel-hide-btn" data-hide-section="social_digest" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
          </div>
        </div>
        <p class="section-desc">Overview of all captured social discourse, executive LinkedIn themes, and LLM-synthesized takeaways across all tracked enterprises.</p>
        ${sectionBody('social_digest')}
      </div>
    `;
  }

  let opportunitiesHtml = '';
  if (showAlerts || showDomain) {
    const gridClass = (showAlerts && showDomain) ? 'digest-grid-2' : 'digest-grid-1';
    opportunitiesHtml = `
      <div class="${gridClass}">
        ${showAlerts ? `
          <div class="panel">
            <div class="panel-title">
              <span><i class="bi bi-lightning-charge-fill"></i> Global Sales Alerts &amp; StradIT Service Line Opportunities</span>
              <div class="panel-title-tools">
                <span class="context-badge ai"><i class="bi bi-stars"></i> AI Matcher</span>
                <button type="button" class="panel-hide-btn" data-hide-section="sales_alerts" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
              </div>
            </div>
            <p class="section-desc">High-priority service alignment opportunities detected across all accounts based on keyword citations and public statements.</p>
            ${sectionBody('sales_alerts')}
          </div>
        ` : ''}

        ${showDomain ? `
          <div class="panel">
            <div class="panel-title">
              <span><i class="bi bi-rocket-takeoff-fill"></i> Emerging Domain Expansion &amp; Custom Integration</span>
              <div class="panel-title-tools">
                <span class="context-badge live"><i class="bi bi-layers-fill"></i> Across All Accounts</span>
                <button type="button" class="panel-hide-btn" data-hide-section="domain_expansion" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
              </div>
            </div>
            <p class="section-desc">Trending enterprise initiatives and adjacent technology domains where StradIT can engineer custom integrated solutions, rolled up across every tracked account.</p>
            ${sectionBody('domain_expansion')}
          </div>
        ` : ''}
      </div>
    `;
  }

  let movementsAndJobsHtml = '';
  if (showCxoMovements || showJobs) {
    const gridClass = (showCxoMovements && showJobs) ? 'digest-grid-2' : 'digest-grid-1';
    movementsAndJobsHtml = `
      <div class="${gridClass}">
        ${showCxoMovements ? `
          <div class="panel">
            <div class="panel-title">
              <span><i class="bi bi-arrow-left-right" style="color:var(--brand);"></i> Executive Leadership Transitions &amp; CXO Movements</span>
              <div class="panel-title-tools">
                <span class="context-badge live"><i class="bi bi-broadcast"></i> Live Signal Monitor</span>
                <button type="button" class="panel-hide-btn" data-hide-section="cxo_movements" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
              </div>
            </div>
            <p class="section-desc">Track real-time executive appointments, departures, and role movements across enterprise accounts.</p>
            ${sectionBody('cxo_movements')}
          </div>
        ` : ''}

        ${showJobs ? `
          <div class="panel">
            <div class="panel-title">
              <span><i class="bi bi-linkedin"></i> Recent LinkedIn Job Postings</span>
              <div class="panel-title-tools">
                <span class="context-badge live"><i class="bi bi-broadcast"></i> Across All Accounts</span>
                <button type="button" class="panel-hide-btn" data-hide-section="linkedin_jobs" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
              </div>
            </div>
            <p class="section-desc">Newest scraped job postings across every tracked account — a hiring-activity signal worth flagging on calls.</p>
            ${sectionBody('linkedin_jobs')}
          </div>
        ` : ''}
      </div>
    `;
  }

  const noSectionsVisible = visibleCount === 0;

  dashEmpty.innerHTML = `
    <div class="digest-header">
      <div class="digest-header-top">
        <div class="digest-header-main">
          <h2 class="digest-title"><i class="bi bi-bar-chart-line-fill"></i> Global Accounts Dashboard</h2>
          <p class="digest-sub">Live intelligence workspace tracking <strong>${state.accounts.length} enterprise account${state.accounts.length !== 1 ? 's' : ''}</strong>. Continuously aggregates signals from executive social feeds, SEC filings, organizational hierarchies, and StradIT service-fit opportunities.</p>
        </div>
        <div class="digest-header-actions">
          <div class="digest-customize-wrap">
            <button type="button" class="digest-customize-btn" id="digestCustomizeBtn" title="Show or hide dashboard sections">
              <i class="bi bi-sliders"></i> Customize View <span class="customize-badge">${visibleCount}/${DIGEST_SECTIONS.length}</span> <i class="bi bi-chevron-down"></i>
            </button>
            <div class="digest-customize-menu d-none" id="digestCustomizeMenu">
              <div class="digest-customize-menu-header">
                <span><i class="bi bi-layout-text-window"></i> Dashboard Sections</span>
                <div class="digest-menu-actions">
                  <button type="button" class="customize-link-btn" id="digestShowAllBtn">Show All</button>
                  <span class="sep">·</span>
                  <button type="button" class="customize-link-btn" id="digestResetBtn">Reset</button>
                </div>
              </div>
              <div class="digest-customize-list">
                ${DIGEST_SECTIONS.map(s => {
                  const isChecked = state.digestSectionVisibility[s.id] !== false;
                  return `
                    <label class="digest-customize-item ${isChecked ? 'active' : ''}">
                      <input type="checkbox" class="digest-section-cb" data-section-id="${s.id}" ${isChecked ? 'checked' : ''}>
                      <i class="bi ${s.icon} item-icon"></i>
                      <div class="item-info">
                        <div class="item-name">${esc(s.label)}</div>
                        <div class="item-desc">${esc(s.desc)}</div>
                      </div>
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Workflow Steps — always eager: static markup, zero compute cost, not
         part of the lazy-load mechanism by design. -->
    ${showStepGuide ? `
      <div class="step-guide">
        <div class="step-guide-item active"><span class="step-guide-num">1</span> <strong>Choose Account:</strong> Select any organization from the left navigator</div>
        <div class="step-guide-item"><span class="step-guide-num">2</span> <strong>Inspect LOBs:</strong> Drill into specific operating divisions</div>
        <div class="step-guide-item"><span class="step-guide-num">3</span> <strong>Review Signals:</strong> Match offerings with live buyer pain points</div>
        <div class="step-guide-item"><span class="step-guide-num">4</span> <strong>Open Call Prep:</strong> Click contacts for tailored talk tracks</div>
        <button type="button" class="step-guide-hide-btn" data-hide-section="step_guide" title="Hide workflow guide"><i class="bi bi-x-lg"></i></button>
      </div>
    ` : ''}

    ${topAccountsHtml}

    ${socialHtml}

    ${opportunitiesHtml}

    ${movementsAndJobsHtml}

    ${noSectionsVisible ? `
      <div class="empty-block" style="padding: 36px 20px; text-align: center;">
        <div class="empty-block-icon" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 10px;"><i class="bi bi-layout-sidebar-inset"></i></div>
        <div style="font-weight: 700; font-size: 1.05rem; color: var(--text-primary); margin-bottom: 6px;">All sections are currently hidden</div>
        <div style="color: var(--text-secondary); font-size: 0.82rem; margin-bottom: 16px; max-width: 420px; margin-left: auto; margin-right: auto;">You can customize your dashboard layout and re-enable any intelligence module dynamically.</div>
        <button type="button" class="btn btn-primary btn-sm" id="digestEmptyShowAllBtn"><i class="bi bi-eye"></i> Show All Sections</button>
      </div>
    ` : ''}

    <div class="digest-cta"><i class="bi bi-arrow-left-circle-fill"></i> <span><strong>Ready to explore?</strong> Select any account from the left panel to open its complete intelligence dossier and contact matrix.</span></div>
  `;

  observeDigestSections();
}

// ── Digest-only wiring: customize menu, hide/show/reset sections ──
dashEmpty.addEventListener('click', function (e) {
  const customizeBtn = e.target.closest('#digestCustomizeBtn');
  if (customizeBtn) {
    e.stopPropagation();
    const menu = el('digestCustomizeMenu');
    if (menu) menu.classList.toggle('d-none');
    return;
  }

  const hideBtn = e.target.closest('[data-hide-section]');
  if (hideBtn) {
    e.stopPropagation();
    const sectionId = hideBtn.dataset.hideSection;
    if (sectionId) {
      state.digestSectionVisibility[sectionId] = false;
      saveDigestSectionVisibility();
      renderDigest();
      const sDef = DIGEST_SECTIONS.find(s => s.id === sectionId);
      showToast(`Hidden: ${sDef ? sDef.label : 'Section'}. Re-enable from "Customize View".`);
    }
    return;
  }

  const showAllBtn = e.target.closest('#digestShowAllBtn, #digestEmptyShowAllBtn');
  if (showAllBtn) {
    e.stopPropagation();
    DIGEST_SECTIONS.forEach(s => { state.digestSectionVisibility[s.id] = true; });
    saveDigestSectionVisibility();
    renderDigest();
    showToast('All dashboard sections enabled.');
    return;
  }

  const resetBtn = e.target.closest('#digestResetBtn');
  if (resetBtn) {
    e.stopPropagation();
    DIGEST_SECTIONS.forEach(s => { state.digestSectionVisibility[s.id] = true; });
    saveDigestSectionVisibility();
    renderDigest();
    showToast('Dashboard layout reset to default.');
    return;
  }

  // Keep menu open if clicking inside it
  if (e.target.closest('#digestCustomizeMenu')) {
    e.stopPropagation();
  }
});

dashEmpty.addEventListener('change', function (e) {
  const cb = e.target.closest('.digest-section-cb');
  if (cb) {
    const sectionId = cb.dataset.sectionId;
    if (sectionId) {
      state.digestSectionVisibility[sectionId] = cb.checked;
      saveDigestSectionVisibility();
      renderDigest();
      // Re-open menu after render so user can continue toggling
      const menu = el('digestCustomizeMenu');
      if (menu) menu.classList.remove('d-none');
      const sDef = DIGEST_SECTIONS.find(s => s.id === sectionId);
      showToast(`${cb.checked ? 'Enabled' : 'Hidden'}: ${sDef ? sDef.label : 'Section'}`);
    }
  }
});

// Close customize menu on outside click
document.addEventListener('click', function (e) {
  if (!e.target.closest('#digestCustomizeBtn') && !e.target.closest('#digestCustomizeMenu')) {
    const menu = el('digestCustomizeMenu');
    if (menu && !menu.classList.contains('d-none')) {
      menu.classList.add('d-none');
    }
  }
});
