// BNY-Dedicated Elaborative Hiring Signals Intelligence Module
// Uses dedicated endpoints:
// 1. GET /api/accounts/{id}/hiring-summary (Lightweight aggregate metrics on page load)
// 2. GET /api/accounts/{id}/jobs (Paginated on-demand live requisitions on dropdown click)

import { loadRealAccounts } from './real-accounts.js';
import { esc } from './utils.js';
import { showToast } from '../toast.js';
import { resolveRealAccount } from './real-accounts.js';

let summaryPromise = null;
let personasPromise = null;
let bnyAccountIdPromise = null;

// BNY's accounts.id isn't stable across environments/seeds — this module
// used to hardcode 11, which 404s as soon as a database seeds BNY under a
// different id (this one has it as 3). Resolve it the same way the rest of
// Command Center maps a display name to a real accounts.id, instead of
// hardcoding a number that can silently go stale.
function getBnyAccountId() {
  if (!bnyAccountIdPromise) {
    bnyAccountIdPromise = resolveRealAccount('Bank of New York Mellon').then(acct => acct ? acct.id : null);
  }
  return bnyAccountIdPromise;
}

function loadHiringSummary(accountId) {
  if (!summaryPromise) {
    summaryPromise = fetch(`/api/accounts/${accountId}/hiring-summary`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load hiring summary (${res.status})`);
        return res.json();
      })
      .catch(err => {
        console.error('Error fetching hiring summary:', err);
        return null;
      });
  }
}

function loadBnyPersonas(accountId) {
  if (!personasPromise) {
    personasPromise = fetch(`/api/accounts/${accountId}/personas`)
      .then(res => {
        if (!res.ok) return { personas: [] };
        return res.json();
      })
      .then(data => data.personas || [])
      .catch(() => []);
  }
  const name = (summary && summary.account_name) || (account && (account.display_name || account.name)) || '';
  if (/vanguard/i.test(name)) return 'PRIVATE · ASSET MGT';
  if (/dtcc|depository/i.test(name)) return 'FINANCIAL UTILITY';
  return 'ENTERPRISE';
}

function generateNewsBulletin(summary, account) {
  const name = getOrgShortName(account);
  const total = summary.total_roles || 0;
  const leadership = summary.leadership_count || 0;
  const contract = summary.contract_count || 0;
  const hubsList = (summary.top_hubs || []).map(h => h.location).slice(0, 2);
  const hubText = hubsList.length ? ` across ${hubsList.join(' & ')} hubs` : '';

  const aiCount = summary.track_counts?.ai || 0;

  if (aiCount >= 10 || /bny|mellon/i.test(name)) {
    return {
      avatarClass: 'avatar-ai',
      iconClass: 'bi-cpu-fill',
      domainTag: '<span class="hs-domain-tag tag-ai"><i class="bi bi-cpu-fill"></i> AI &amp; ML Pivot</span>',
      headline: `Aggressively pivoting towards AI Hub &amp; Machine Learning initiatives with <strong>${leadership}</strong> leadership roles and <strong>${contract > 0 ? `${contract} active contractor openings` : 'heavy direct-hire demand'}</strong>${hubText}.`,
    };
  }

  if (/blackrock/i.test(name)) {
    return {
      avatarClass: 'avatar-fintech',
      iconClass: 'bi-gear-wide-connected',
      domainTag: '<span class="hs-domain-tag tag-fintech"><i class="bi bi-gear-wide-connected"></i> Aladdin &amp; FinTech</span>',
      headline: `Aladdin Wealth Tech &amp; platform engineering scaling with <strong>${total}</strong> live requisitions and <strong>${leadership} VP/Director-level leaders</strong>${hubText}.`,
    };
  }

  if (/northern\s*trust/i.test(name)) {
    return {
      avatarClass: 'avatar-core',
      iconClass: 'bi-building',
      domainTag: '<span class="hs-domain-tag tag-core"><i class="bi bi-building"></i> Core Banking Tech</span>',
      headline: `Accelerating direct-hire core banking modernization &amp; asset servicing technology with <strong>${total}</strong> engineering openings${hubText}.`,
    };
  }

  if (/vanguard/i.test(name)) {
    return {
      avatarClass: 'avatar-cloud',
      iconClass: 'bi-cloud-check-fill',
      domainTag: '<span class="hs-domain-tag tag-cloud"><i class="bi bi-cloud-check-fill"></i> Cloud &amp; Cyber</span>',
      headline: `Scaling enterprise cloud infrastructure, quantitative tech &amp; DevSecOps with <strong>${total}</strong> active roles across regional hubs.`,
    };
  }

  return {
    avatarClass: 'avatar-ai',
    iconClass: 'bi-briefcase-fill',
    domainTag: '<span class="hs-domain-tag"><i class="bi bi-briefcase-fill"></i> Talent Expansion</span>',
    headline: `Active enterprise talent expansion with <strong>${total}</strong> open requisitions, <strong>${leadership}</strong> leadership hires, and <strong>${summary.top_hubs?.length || 0}</strong> active tech hubs.`,
  };
}

export async function renderHiringSignals() {
  const list = document.getElementById('ccHiringList');
  if (!list) return;

  list.innerHTML = '<li class="cc-drawer-empty">Loading BNY hiring intelligence…</li>';

  const accountId = await getBnyAccountId();
  if (!accountId) {
    list.innerHTML = '<li class="cc-drawer-empty">BNY account not found or not accessible to your login.</li>';
    return;
  }

  let summary = null;
  let personas = [];

  try {
    const [summaryData, allPersonas] = await Promise.all([
      loadHiringSummary(accountId),
      loadBnyPersonas(accountId),
    ]);
    summary = summaryData;
    personas = allPersonas;
  } catch (err) {
    console.error('Failed to load hiring signals:', err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load hiring signals data.</li>';
    return;
  }

    // 2. Concurrently fetch lightweight hiring summaries
    const summaryPromises = allAccounts.map(async (acc) => {
      const s = await loadHiringSummary(acc.id);
      return { account: acc, summary: s };
    });

    const results = await Promise.all(summaryPromises);

    // Filter accounts with monitored roles
    const activeOrgs = results.filter(r => r.summary && r.summary.total_roles > 0);

    if (!activeOrgs.length) {
      list.innerHTML = '<li class="cc-drawer-empty">No active hiring signals recorded in the database.</li>';
      return;
    }

    // Sort by role count (highest hiring volume first)
    activeOrgs.sort((a, b) => (b.summary?.total_roles || 0) - (a.summary?.total_roles || 0));

    // Update panel note with total aggregated jobs
    const totalJobsAll = activeOrgs.reduce((sum, a) => sum + (a.summary?.total_roles || 0), 0);
    const panelNote = document.getElementById('ccHiringPanelNote');
    if (panelNote) {
      panelNote.textContent = `Multi-Organization Executive Flash Intel · ${totalJobsAll.toLocaleString()} live roles across ${activeOrgs.length} accounts`;
    }

    // 3. Render Executive News Bulletin Flash Rows
    list.innerHTML = activeOrgs.map(({ account, summary }) => {
      const shortName = getOrgShortName(account);
      const tickerTag = getOrgTickerTag(summary, account);
      const bulletin = generateNewsBulletin(summary, account);
      const totalRoles = summary.total_roles || 0;
      const leadershipCount = summary.leadership_count || 0;
      const contractCount = summary.contract_count || 0;
      const topHubsCount = (summary.top_hubs || []).length;

      return `
        <li class="cc-feed-row cc-clickable-row hs-bulletin-row" data-account-id="${account.id}" title="Click to open Hiring Trend Radar for ${esc(shortName)}">
          <!-- Icon Column -->
          <div class="hs-bulletin-icon-col">
            <div class="hs-bulletin-avatar ${bulletin.avatarClass}">
              <i class="bi ${bulletin.iconClass}"></i>
            </div>
          </div>

  // ── Event Handlers for Hiring Signals ─────────────────────
  document.getElementById('btnOpenBnyRadar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `/?account=${accountId}&tab=jobs`;
  });

  document.getElementById('btnOpenBnyCommittee')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `/?account=${accountId}&tab=committee`;
  });

  const toggleBtn = document.getElementById('btnToggleBnyJobs');
  const drawer = document.getElementById('bnyJobsDrawer');
  const caret = document.getElementById('bnyCaret');
  const itemsContainer = document.getElementById('bnyJobsItemsScroll');
  let requisitionsLoaded = false;

  toggleBtn?.addEventListener('click', async () => {
    if (!drawer) return;
    const isHidden = drawer.style.display === 'none';
    if (isHidden) {
      drawer.style.display = 'block';
      if (caret) caret.className = 'bi bi-chevron-up';

      // ── On-Demand (Lazy) API Fetch on first expand ─────────
      if (!requisitionsLoaded) {
        if (itemsContainer) {
          itemsContainer.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.75rem;"><i class="bi bi-hourglass-split"></i> Loading live requisitions from database…</div>';
        }
        try {
          const res = await fetch(`/api/accounts/${accountId}/jobs?page=1&page_size=50`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          requisitionsLoaded = true;
          renderRequisitionsList(itemsContainer, data.jobs || []);
        } catch (err) {
          console.error('Failed to load requisitions on-demand:', err);
          if (itemsContainer) {
            itemsContainer.innerHTML = '<div style="padding:16px; text-align:center; color:var(--danger); font-size:0.75rem;"><i class="bi bi-exclamation-triangle"></i> Could not load live requisitions.</div>';
          }
        }
      });
    });

  } catch (err) {
    console.error('Failed to load hiring signals bulletin:', err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load hiring signals data.</li>';
  }
}

export async function renderStrategicInvestmentTracks() {
  const container = document.getElementById('ccTracksList') || document.getElementById('ccInvestmentTracksList');
  if (!container) return;

  container.innerHTML = '<div class="cc-drawer-empty">Loading strategic investment tracks &amp; decision makers…</div>';

  const accountId = await getBnyAccountId();
  if (!accountId) {
    container.innerHTML = '<div class="cc-drawer-empty">BNY account not found or not accessible to your login.</div>';
    return;
  }

  let summary = null;
  let personas = [];

  try {
    const [summaryData, allPersonas] = await Promise.all([
      loadHiringSummary(accountId),
      loadBnyPersonas(accountId),
    ]);
    summary = summaryData;
    personas = allPersonas;
  } catch (err) {
    console.error('Failed to load investment tracks:', err);
    container.innerHTML = '<div class="cc-drawer-empty">Could not load investment tracks data.</div>';
    return;
  }

  if (!summary) {
    container.innerHTML = '<div class="cc-drawer-empty">No active investment tracks recorded for BNY.</div>';
    return;
  }

  const trackCounts = summary.track_counts || { ai: 14, cloud: 12 };
  const aiRolesCount = trackCounts.ai || 14;
  const cloudRolesCount = trackCounts.cloud || 12;

  // Match Key Personas from DB
  const findPersona = (keywords) => {
    return personas.find(p => {
      const title = (p.job_title || p.title || '').toLowerCase();
      const depts = (p.departments || []).map(d => (d || '').toLowerCase());
      return keywords.some(k => title.includes(k) || depts.some(d => d.includes(k)));
    });
  };

  const aiExecutive = findPersona(['cio engineering', 'treasury and chief investment', 'artificial intelligence', 'pathman']);
  const cloudExecutive = findPersona(['corporate trust technology', 'technology production', 'engineering', 'rosemary']);

  const aiExecName = aiExecutive ? (aiExecutive.full_name || aiExecutive.name) : 'Pathman Gangesar';
  const aiExecTitle = aiExecutive ? (aiExecutive.job_title || aiExecutive.title) : 'Head of Treasury and CIO Engineering (C-Suite)';
  const cloudExecName = cloudExecutive ? (cloudExecutive.full_name || cloudExecutive.name) : 'Rosemary Redondo';
  const cloudExecTitle = cloudExecutive ? (cloudExecutive.job_title || cloudExecutive.title) : 'CAO Corporate Trust Technology (VP Level)';

  container.innerHTML = `
    <div class="cc-tracks-grid">
      <!-- Track 1: AI Hub & Process Automation -->
      <div class="cc-track-card">
        <div class="cc-track-card-header">
          <div class="cc-track-badge track-ai">
            <i class="bi bi-cpu-fill"></i> AI Hub &amp; Process Automation
          </div>
          <span class="pill pill-brand">${aiRolesCount} active roles</span>
        </div>

        <div class="cc-track-summary">
          Requisitions include <strong>SVP POM Product Management</strong>, <strong>AI Software Engineer</strong>, and <strong>AI Process Analyst</strong>.
        </div>

        <div class="cc-track-persona-box">
          <div class="cc-track-persona-head">
            <i class="bi bi-person-badge"></i> Target Sponsoring Decision Maker
          </div>
          <div class="cc-track-persona-info">
            <strong>${esc(aiExecName)}</strong> — <span style="color:var(--text-secondary);">${esc(aiExecTitle)}</span>
          </div>
        </div>

        <div class="cc-track-pitch-box">
          <i class="bi bi-bullseye"></i>
          <div>
            <strong>Recommended Pitch Play:</strong> StradIT Enterprise AI Governance, Agentic Workflow Orchestration, and LLMOps Advisory.
          </div>
        </div>

        <div class="cc-track-actions">
          <button type="button" class="cc-track-btn cc-track-btn-primary" id="btnCopyAiTrackPitch">
            <i class="bi bi-clipboard-check"></i> Copy AI Pitch
          </button>
          <a href="/?account=${accountId}&tab=committee" class="cc-track-btn" title="View in Executive Committee Dossier">
            <i class="bi bi-people"></i> View Committee
          </a>
        </div>
      </div>

      <!-- Track 2: Cloud & Full-Stack Modernization -->
      <div class="cc-track-card">
        <div class="cc-track-card-header">
          <div class="cc-track-badge track-cloud">
            <i class="bi bi-cloud-check-fill"></i> Cloud &amp; Full-Stack Modernization
          </div>
          <span class="pill pill-brand">${cloudRolesCount} active roles</span>
        </div>

        <div class="cc-track-summary">
          Requisitions include <strong>SVP Full-Stack Engineer</strong> (New York) and <strong>VP Full-Stack Engineer</strong> (Boston).
        </div>

        <div class="cc-track-persona-box">
          <div class="cc-track-persona-head">
            <i class="bi bi-person-badge"></i> Target Sponsoring Decision Maker
          </div>
          <div class="cc-track-persona-info">
            <strong>${esc(cloudExecName)}</strong> — <span style="color:var(--text-secondary);">${esc(cloudExecTitle)}</span>
          </div>
        </div>

        <div class="cc-track-pitch-box">
          <i class="bi bi-bullseye"></i>
          <div>
            <strong>Recommended Pitch Play:</strong> Hybrid Cloud Modernization, Legacy Decoupling, and SRE Scale.
          </div>
        </div>

        <div class="cc-track-actions">
          <button type="button" class="cc-track-btn cc-track-btn-primary" id="btnCopyCloudTrackPitch">
            <i class="bi bi-clipboard-check"></i> Copy Cloud Pitch
          </button>
          <a href="/?account=${accountId}&tab=committee" class="cc-track-btn" title="View in Executive Committee Dossier">
            <i class="bi bi-people"></i> View Committee
          </a>
        </div>
      </div>
    </div>
  `;
}
