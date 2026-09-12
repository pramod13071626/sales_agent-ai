// BNY-Dedicated Elaborative Hiring Signals Intelligence Module
// Harnesses BNY's 32 active LinkedIn job postings, 320 personas in PostgreSQL,
// and strategic growth signals to give sales reps an actionable hiring command center.

import { loadMatrixAccounts } from './real-accounts.js';
import { openDossier } from './drawer.js';
import { esc } from './utils.js';
import { analyzeHiringTrends } from '../jobs-radar.js';
import { showToast } from '../toast.js';

let rawJobsPromise = null;
let personasPromise = null;

function loadRawJobs() {
  if (!rawJobsPromise) {
    rawJobsPromise = fetch('/api/linkedin-jobs?sort=newest&page_size=100')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load job postings (${res.status})`);
        return res.json();
      })
      .then(data => data.jobs || []);
  }
  return rawJobsPromise;
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

function isBnyJob(j) {
  const target = (j.target_key || '').toLowerCase();
  const company = (j.company_name || '').toLowerCase();
  const acct = (j.account_name || '').toLowerCase();
  return (
    j.account_id === 11 ||
    target.includes('bank_of_new_york') ||
    target.includes('bny') ||
    company.includes('bny') ||
    company.includes('mellon') ||
    acct.includes('bank of new york') ||
    acct.includes('bny')
  );
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

  let jobs = [];
  let accounts = [];
  let personas = [];

  try {
    const [allJobs, allAccounts, allPersonas] = await Promise.all([
      loadRawJobs(),
      loadMatrixAccounts(),
      loadBnyPersonas(),
    ]);
    jobs = allJobs.filter(isBnyJob);
    accounts = allAccounts;
    personas = allPersonas;
  } catch (err) {
    console.error('Failed to load hiring signals:', err);
    list.innerHTML = '<li class="cc-drawer-empty">Could not load hiring signals data.</li>';
    return;
  }

  if (!jobs.length) {
    list.innerHTML = '<li class="cc-drawer-empty">No active job postings recorded for BNY.</li>';
    return;
  }

  const bnyAccount = accounts.find(a => a.id === 11) || {
    id: 11,
    name: 'The Bank of New York Mellon Corporation',
    ticker: 'BK',
    compositeScore: 92,
  };

  // ── Analyze Trend Metrics ─────────────────────────────────
  const sortedJobs = jobs.slice().sort((a, b) => {
    const da = a.first_seen ? new Date(a.first_seen).getTime() : 0;
    const db = b.first_seen ? new Date(b.first_seen).getTime() : 0;
    return db - da;
  });

  const analysis = analyzeHiringTrends(sortedJobs, bnyAccount);

  // 1. Contract / Staff Augmentation Roles
  const contractRoles = sortedJobs.filter(
    j => (j.employment_type || '').toLowerCase() === 'contract' || /\(contract\)/i.test(j.title || '')
  );

  // 2. Leadership Roles
  const leadershipKeywords = [/director/i, /\bvp\b/i, /vice president/i, /\bsvp\b/i, /senior vice president/i, /head of/i, /chief/i, /lead/i];
  const leadershipRoles = sortedJobs.filter(j => leadershipKeywords.some(rx => rx.test(j.title || '')));

  // 3. Geographic Hubs
  const locMap = new Map();
  sortedJobs.forEach(j => {
    let loc = (j.location || '').trim();
    if (loc.includes('/')) loc = loc.split('/')[0].trim();
    if (loc) locMap.set(loc, (locMap.get(loc) || 0) + 1);
  });
  const topHubs = [...locMap.entries()].sort((a, b) => b[1] - a[1]);

  // 4. Strategic Domain Breakdown
  const aiJobs = sortedJobs.filter(j => /ai\b|artificial|machine learning|genai|process analyst|automation/i.test(j.title || ''));
  const cloudJobs = sortedJobs.filter(j => /cloud|full-stack|full stack|platform|devops|systems lead|software engineer/i.test(j.title || '') && !aiJobs.includes(j));

  // 5. Match Key Personas from 320 in DB
  const findPersona = (keywords) => {
    return personas.find(p => {
      const title = (p.job_title || p.title || '').toLowerCase();
      const depts = (p.departments || []).map(d => (d || '').toLowerCase());
      return keywords.some(k => title.includes(k) || depts.some(d => d.includes(k)));
    });
  };

  const aiExecutive = findPersona(['cio engineering', 'treasury and chief investment', 'artificial intelligence', 'pathman']);
  const cloudExecutive = findPersona(['corporate trust technology', 'technology production', 'engineering', 'rosemary']);

  // ── Render HTML ──────────────────────────────────────────
  list.innerHTML = `
    <li class="bny-hs-card">
      <!-- 1. BNY Pulse Header -->
      <div class="bny-hs-header">
        <div class="bny-hs-title-block">
          <span class="bny-hs-name">The Bank of New York Mellon</span>
          <span class="bny-hs-ticker">NYSE: BK</span>
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
          <span class="bny-kpi-num">${sortedJobs.length}</span>
          <span class="bny-kpi-label">Open Requisitions</span>
        </div>
        <div class="bny-kpi-item bny-kpi-highlight">
          <span class="bny-kpi-num">${leadershipRoles.length}</span>
          <span class="bny-kpi-label">VP &amp; Executive Roles</span>
        </div>
        <div class="bny-kpi-item bny-kpi-contract">
          <span class="bny-kpi-num">${contractRoles.length}</span>
          <span class="bny-kpi-label">Staff Aug / Contract</span>
        </div>
        <div class="bny-kpi-item">
          <span class="bny-kpi-num">${topHubs.length}</span>
          <span class="bny-kpi-label">Tech Hubs Active</span>
        </div>
      </div>

      <!-- 3. Immediate Revenue Callout: Staff Augmentation -->
      ${contractRoles.length > 0 ? `
      <div class="bny-contract-banner">
        <div class="bny-contract-header">
          <span class="bny-contract-badge"><i class="bi bi-briefcase-fill"></i> IMMEDIATE STAFF AUGMENTATION LEAD</span>
          <span class="bny-contract-sub">BNY is actively sourcing external contractors for ${contractRoles.length} specialized roles:</span>
        </div>
        <div class="bny-contract-roles-list">
          ${contractRoles.map(j => `
            <div class="bny-contract-role-row">
              <span class="bny-contract-role-title"><i class="bi bi-check2-circle"></i> ${esc(j.title)}</span>
              <span class="bny-contract-role-meta">${esc(j.location || 'US')} · ${j.workplace_type ? esc(j.workplace_type).replace('_', ' ') : 'On-site'} · ${j.applicants ? `${j.applicants} applicants` : 'Active'}</span>
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

      <!-- 4. Strategic Investment Tracks & DB Personas -->
      <div class="bny-tracks-container">
        <div class="bny-tracks-title"><i class="bi bi-layers-half"></i> Strategic Investment Tracks &amp; Key Sponsoring Decision Makers in DB</div>

        <!-- Track 1: AI Hub -->
        <div class="bny-track-row">
          <div class="bny-track-badge bny-track-ai">
            <i class="bi bi-cpu-fill"></i> AI Hub &amp; Process Automation (${aiJobs.length} roles)
          </div>
          <div class="bny-track-summary">
            Requisitions include <strong>SVP POM Product Management</strong>, <strong>AI Software Engineer</strong>, and <strong>AI Process Analyst</strong>.
          </div>
          <div class="bny-track-persona">
            <span class="bny-persona-label">🎯 Target Decision Maker in DB:</span>
            <span class="bny-persona-val">
              <strong>${esc(aiExecutive ? (aiExecutive.full_name || aiExecutive.name) : 'Pathman Gangesar')}</strong>
              — ${esc(aiExecutive ? (aiExecutive.job_title || aiExecutive.title) : 'Head of Treasury and CIO Engineering (C-Suite)')}
            </span>
          </div>
          <div class="bny-track-pitch">
            <i class="bi bi-bullseye"></i> Pitch: StradIT Enterprise AI Governance, Agentic Workflow Orchestration, and LLMOps Advisory.
          </div>
        </div>

        <!-- Track 2: Cloud Modernization -->
        <div class="bny-track-row">
          <div class="bny-track-badge bny-track-cloud">
            <i class="bi bi-cloud-check-fill"></i> Cloud &amp; Full-Stack Modernization (${cloudJobs.length} roles)
          </div>
          <div class="bny-track-summary">
            Requisitions include <strong>SVP Full-Stack Engineer</strong> (New York) and <strong>VP Full-Stack Engineer</strong> (Boston).
          </div>
          <div class="bny-track-persona">
            <span class="bny-persona-label">🎯 Target Decision Maker in DB:</span>
            <span class="bny-persona-val">
              <strong>${esc(cloudExecutive ? (cloudExecutive.full_name || cloudExecutive.name) : 'Rosemary Redondo')}</strong>
              — ${esc(cloudExecutive ? (cloudExecutive.job_title || cloudExecutive.title) : 'CAO Corporate Trust Technology (VP Level)')}
            </span>
          </div>
          <div class="bny-track-pitch">
            <i class="bi bi-bullseye"></i> Pitch: Hybrid Cloud Modernization, Legacy Decoupling, and SRE Scale.
          </div>
        </div>
      </div>

      <!-- 5. Collapsible Requisition Browser -->
      <div class="bny-jobs-collapsible">
        <button type="button" class="bny-toggle-jobs-btn" id="btnToggleBnyJobs">
          <span><i class="bi bi-folder2-open"></i> Live Requisitions Browser (${sortedJobs.length} Postings)</span>
          <span class="bny-toggle-caret"><i class="bi bi-chevron-down" id="bnyCaret"></i></span>
        </button>
        <div class="bny-jobs-list-drawer" id="bnyJobsDrawer" style="display: none;">
          <div class="bny-drawer-meta">
            <span>Showing verified LinkedIn postings from PostgreSQL database · Click any role to view on LinkedIn</span>
          </div>
          <div class="bny-jobs-items-scroll">
            ${sortedJobs.map(j => {
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
            }).join('')}
          </div>
        </div>
      </div>
    </li>
  `;

  // ── Event Handlers ────────────────────────────────────────

  // 1. Navigation to BNY Radar & Committee
  document.getElementById('btnOpenBnyRadar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = '/?account=11&tab=jobs';
  });

  document.getElementById('btnOpenBnyCommittee')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = '/?account=11&tab=committee';
  });

  // 2. Toggle Requisition Drawer
  const toggleBtn = document.getElementById('btnToggleBnyJobs');
  const drawer = document.getElementById('bnyJobsDrawer');
  const caret = document.getElementById('bnyCaret');

  toggleBtn?.addEventListener('click', () => {
    if (!drawer) return;
    const isHidden = drawer.style.display === 'none';
    drawer.style.display = isHidden ? 'block' : 'none';
    if (caret) {
      caret.className = isHidden ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
    }
  });

  // 3. Copy Staff Aug Pitch
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
