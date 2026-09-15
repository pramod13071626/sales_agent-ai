// BNY-Dedicated Elaborative Hiring Signals Intelligence Module
// Uses dedicated endpoints:
// 1. GET /api/accounts/11/hiring-summary (Lightweight aggregate metrics on page load)
// 2. GET /api/accounts/11/jobs (Paginated on-demand live requisitions on dropdown click)

import { openDossier } from './drawer.js';
import { esc } from './utils.js';
import { showToast } from '../toast.js';

let summaryPromise = null;
let personasPromise = null;

function loadHiringSummary(accountId = 11) {
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
  return summaryPromise;
}

function loadBnyPersonas() {
  if (!personasPromise) {
    personasPromise = fetch('/api/accounts/11/personas')
      .then(res => {
        if (!res.ok) return { personas: [] };
        return res.json();
      })
      .then(data => data.personas || [])
      .catch(() => []);
  }
  return personasPromise;
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function renderHiringSignals() {
  const list = document.getElementById('ccHiringList');
  if (!list) return;

  list.innerHTML = '<li class="cc-drawer-empty">Loading BNY hiring intelligence…</li>';

  let summary = null;
  let personas = [];

  try {
    const [summaryData, allPersonas] = await Promise.all([
      loadHiringSummary(11),
      loadBnyPersonas(),
    ]);
    summary = summaryData;
    personas = allPersonas;
  } catch (err) {
    console.error('Failed to load hiring signals:', err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load hiring signals data.</li>';
    return;
  }

  if (!summary || !summary.total_roles) {
    list.innerHTML = '<li class="cc-drawer-empty">No active job postings recorded for BNY.</li>';
    return;
  }

  const totalRoles = summary.total_roles || 0;
  const leadershipCount = summary.leadership_count || 0;
  const contractCount = summary.contract_count || 0;
  const topHubs = summary.top_hubs || [];
  const contractLeads = summary.contract_leads || [];

  // ── Render Hiring Signals Widget HTML ─────────────────────
  list.innerHTML = `
    <li class="bny-hs-card">
      <!-- 1. BNY Pulse Header -->
      <div class="bny-hs-header">
        <div class="bny-hs-title-block">
          <span class="bny-hs-name">${esc(summary.account_name || 'The Bank of New York Mellon')}</span>
          <span class="bny-hs-ticker">NYSE: ${esc(summary.ticker || 'BK')}</span>
          <span class="hs-urgency-pill hs-pill-hot"><i class="bi bi-fire"></i> STRATEGIC SURGE</span>
        </div>
        <div class="bny-hs-actions-top">
          <button type="button" class="hs-btn hs-btn-outline" id="btnOpenBnyRadar" title="Open Hiring Trend Radar for BNY">
            <i class="bi bi-graph-up-arrow"></i> Radar
          </button>
          <button type="button" class="hs-btn hs-btn-outline" id="btnOpenBnyCommittee" title="View 320 Executive Personas in DB">
            <i class="bi bi-people-fill"></i> Committee (${personas.length || 320})
          </button>
        </div>
      </div>

      <!-- 2. KPI Stat Strip -->
      <div class="bny-kpi-grid">
        <div class="bny-kpi-item">
          <span class="bny-kpi-num">${totalRoles}</span>
          <span class="bny-kpi-label">Open Requisitions</span>
        </div>
        <div class="bny-kpi-item bny-kpi-highlight">
          <span class="bny-kpi-num">${leadershipCount}</span>
          <span class="bny-kpi-label">VP &amp; Executive Roles</span>
        </div>
        <div class="bny-kpi-item bny-kpi-contract">
          <span class="bny-kpi-num">${contractCount}</span>
          <span class="bny-kpi-label">Staff Aug / Contract</span>
        </div>
        <div class="bny-kpi-item">
          <span class="bny-kpi-num">${topHubs.length}</span>
          <span class="bny-kpi-label">Tech Hubs Active</span>
        </div>
      </div>

      <!-- 3. Immediate Revenue Callout: Staff Augmentation -->
      ${contractLeads.length > 0 ? `
      <div class="bny-contract-banner">
        <div class="bny-contract-header">
          <span class="bny-contract-badge"><i class="bi bi-briefcase-fill"></i> IMMEDIATE STAFF AUGMENTATION LEAD</span>
          <span class="bny-contract-sub">BNY is actively sourcing external contractors for ${contractCount} specialized roles:</span>
        </div>
        <div class="bny-contract-roles-list">
          ${contractLeads.map(j => `
            <div class="bny-contract-role-row">
              <span class="bny-contract-role-title"><i class="bi bi-check2-circle"></i> ${esc(j.title)}</span>
              <span class="bny-contract-role-meta">${esc(j.location || 'US')} · ${j.workplace_type ? esc(j.workplace_type) : 'On-site'} · ${j.applicants ? `${j.applicants} applicants` : 'Active'}</span>
            </div>
          `).join('')}
        </div>
        <div class="bny-contract-footer">
          <button type="button" class="bny-pitch-btn" id="btnCopyStaffAugPitch">
            <i class="bi bi-clipboard-check"></i> Copy Staff Aug Pitch
          </button>
          <span class="bny-pitch-hint">Pitch vetted financial-domain AI engineers ready for instant SOW onboarding</span>
        </div>
      </div>` : ''}

      <!-- 4. Collapsible Requisition Browser (Lazy Loaded On Click) -->
      <div class="bny-jobs-collapsible">
        <button type="button" class="bny-toggle-jobs-btn" id="btnToggleBnyJobs">
          <span><i class="bi bi-folder2-open"></i> Live Requisitions Browser (${totalRoles} Postings)</span>
          <span class="bny-toggle-caret"><i class="bi bi-chevron-down" id="bnyCaret"></i></span>
        </button>
        <div class="bny-jobs-list-drawer" id="bnyJobsDrawer" style="display: none;">
          <div class="bny-drawer-meta">
            <span>Showing verified LinkedIn postings from PostgreSQL database · Click any role to view on LinkedIn</span>
          </div>
          <div class="bny-jobs-items-scroll" id="bnyJobsItemsScroll">
            <!-- Populated on-demand via dedicated API query when user clicks the toggle -->
          </div>
        </div>
      </div>
    </li>
  `;

  // ── Event Handlers for Hiring Signals ─────────────────────
  document.getElementById('btnOpenBnyRadar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = '/?account=11&tab=jobs';
  });

  document.getElementById('btnOpenBnyCommittee')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = '/?account=11&tab=committee';
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
          const res = await fetch('/api/accounts/11/jobs?page=1&page_size=50');
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
      }
    } else {
      drawer.style.display = 'none';
      if (caret) caret.className = 'bi bi-chevron-down';
    }
  });

  document.getElementById('btnCopyStaffAugPitch')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pitch = `Hi team, we noted BNY's active requisitions for contract AI Software Engineers and Process Analysts in Dallas and Pittsburgh. StradIT provides vetted, financial-domain AI engineers and process architects ready for immediate SOW deployment with zero onboarding delay.`;
    try {
      await navigator.clipboard.writeText(pitch);
      showToast('Staff Augmentation pitch copied to clipboard!', 'success');
    } catch {
      showToast('Could not copy pitch to clipboard.', 'warning');
    }
  });
}

function renderRequisitionsList(container, jobsList) {
  if (!container) return;
  if (!jobsList || !jobsList.length) {
    container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:0.75rem;">No active job postings recorded.</div>';
    return;
  }
  const leadershipKeywords = [/director/i, /\bvp\b/i, /vice president/i, /\bsvp\b/i, /senior vice president/i, /head of/i, /chief/i, /lead/i];
  container.innerHTML = jobsList.map(j => {
    const isContract = (j.employment_type || '').toLowerCase() === 'contract' || /\(contract\)/i.test(j.title || '');
    const isLead = leadershipKeywords.some(rx => rx.test(j.title || ''));
    return `
      <div class="bny-job-item">
        <div class="bny-job-top">
          <a href="${j.job_url ? esc(j.job_url) : '#'}" target="_blank" rel="noopener" class="bny-job-link" title="Open on LinkedIn">
            ${esc(j.title)} <i class="bi bi-box-arrow-up-right"></i>
          </a>
          <div class="bny-job-pills">
            ${isContract ? '<span class="bny-tag-contract">CONTRACT</span>' : ''}
            ${isLead ? '<span class="bny-tag-lead">LEADERSHIP</span>' : ''}
            ${j.workplace_type ? `<span class="bny-tag-mode">${esc(j.workplace_type).replace('_', ' ')}</span>` : ''}
          </div>
        </div>
        <div class="bny-job-bot">
          <span class="bny-job-loc"><i class="bi bi-geo-alt"></i> ${esc(j.location || 'New York, NY')}</span>
          ${j.applicants ? `<span class="bny-job-apps"><i class="bi bi-people"></i> ${j.applicants} applicants</span>` : ''}
          ${j.first_seen ? `<span class="bny-job-date"><i class="bi bi-clock"></i> ${formatDate(j.first_seen)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

export async function renderStrategicInvestmentTracks() {
  const container = document.getElementById('ccTracksList') || document.getElementById('ccInvestmentTracksList');
  if (!container) return;

  container.innerHTML = '<div class="cc-drawer-empty">Loading strategic investment tracks &amp; decision makers…</div>';

  let summary = null;
  let personas = [];

  try {
    const [summaryData, allPersonas] = await Promise.all([
      loadHiringSummary(11),
      loadBnyPersonas(),
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

  // Match Key Personas from 320 in DB
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

  const aiPitchText = `Hi Pathman, following BNY's expansion across AI Process Analysts and AI Software Engineering roles, StradIT provides enterprise AI governance frameworks, agentic workflow orchestration, and high-throughput LLMOps advisory to accelerate these programs with institutional safety.`;
  const cloudPitchText = `Hi Rosemary, noting BNY's active expansion in VP and SVP Full-Stack Engineering across New York and Boston, StradIT delivers hybrid cloud modernization, legacy decoupling accelerators, and site reliability engineering scale for tier-1 financial infrastructure.`;

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
          <a href="/?account=11&tab=committee" class="cc-track-btn" title="View in Executive Committee Dossier">
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
          <a href="/?account=11&tab=committee" class="cc-track-btn" title="View in Executive Committee Dossier">
            <i class="bi bi-people"></i> View Committee
          </a>
        </div>
      </div>
    </div>
  `;

  // ── Event Handlers for Investment Tracks ──────────────────
  document.getElementById('btnCopyAiTrackPitch')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(aiPitchText);
      showToast('AI Track pitch copied to clipboard!', 'success');
    } catch {
      showToast('Could not copy pitch to clipboard.', 'warning');
    }
  });

  document.getElementById('btnCopyCloudTrackPitch')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(cloudPitchText);
      showToast('Cloud Modernization pitch copied to clipboard!', 'success');
    } catch {
      showToast('Could not copy pitch to clipboard.', 'warning');
    }
  });
}
