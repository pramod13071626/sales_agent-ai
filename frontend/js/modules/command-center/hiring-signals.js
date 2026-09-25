// Multi-Organization Executive News Bulletin & Flash Intelligence Module
// Renders concise, high-impact executive hiring signals across all database organizations on the Command Center.
// Detailed deep-dives (Requisitions browser, staff-aug lists, etc.) are hosted in the Account Level "Hiring Trend Radar".

import { loadRealAccounts, resolveRealAccount } from './real-accounts.js';
import { esc } from './utils.js';
import { renderSkeleton } from '../skeleton.js';
import { createTask } from './actions.js';

// Cache for lightweight summaries
const summaryCache = new Map();
const personasCache = new Map();

let bnyAccountIdPromise = null;

// renderStrategicInvestmentTracks() below is BNY-specific by design (its
// sponsor personas/pitch copy name actual BNY executives), unlike
// renderHiringSignals() which now spans every account. BNY's accounts.id
// isn't stable across environments/seeds — hardcoding it (as this used to)
// 404s as soon as a database seeds BNY under a different id. Resolve it the
// same way the rest of Command Center maps a display name to a real
// accounts.id, instead of hardcoding a number that can silently go stale.
function getBnyAccountId() {
  if (!bnyAccountIdPromise) {
    bnyAccountIdPromise = resolveRealAccount('Bank of New York Mellon').then(acct => acct ? acct.id : null);
  }
  return bnyAccountIdPromise;
}

async function loadHiringSummary(accountId) {
  if (summaryCache.has(accountId)) {
    return summaryCache.get(accountId);
  }
  try {
    const res = await fetch(`/api/accounts/${accountId}/hiring-summary`);
    if (!res.ok) throw new Error(`Failed to load hiring summary (${res.status})`);
    const data = await res.json();
    summaryCache.set(accountId, data);
    return data;
  } catch (err) {
    console.error(`Error fetching hiring summary for account ${accountId}:`, err);
    return null;
  }
}

async function loadPersonas(accountId) {
  if (personasCache.has(accountId)) {
    return personasCache.get(accountId);
  }
  try {
    const res = await fetch(`/api/accounts/${accountId}/personas`);
    if (!res.ok) return [];
    const data = await res.json();
    const list = data.personas || [];
    personasCache.set(accountId, list);
    return list;
  } catch {
    return [];
  }
}

function getOrgShortName(account) {
  if (!account) return 'Enterprise';
  const name = account.display_name || account.name || account.legal_name || '';
  if (/bny|mellon/i.test(name)) return 'BNY Mellon';
  if (/blackrock/i.test(name)) return 'BlackRock';
  if (/northern\s*trust/i.test(name)) return 'Northern Trust';
  if (/vanguard/i.test(name)) return 'The Vanguard Group';
  if (/depository|dtcc/i.test(name)) return 'DTCC';
  return name.split(/,|\s-\s/)[0].trim();
}

function getOrgTickerTag(summary, account) {
  const sym = (summary && summary.ticker) || (account && (account.stock_symbol || account.ticker)) || '';
  if (sym && sym !== 'ORG' && sym !== 'THE' && sym !== 'DEPO') {
    if (sym === 'BNY' || sym === 'BLK') return `NYSE: ${sym}`;
    if (sym === 'NTRS') return `NASDAQ: ${sym}`;
    return sym;
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
      iconClass: 'fa-solid fa-microchip',
      domainTag: '<span class="hs-domain-tag tag-ai"><i class="fa-solid fa-microchip"></i> AI &amp; ML Pivot</span>',
      headline: `Aggressively pivoting towards AI Hub &amp; Machine Learning initiatives with <strong>${leadership}</strong> leadership roles and <strong>${contract > 0 ? `${contract} active contractor openings` : 'heavy direct-hire demand'}</strong>${hubText}.`,
    };
  }

  if (/blackrock/i.test(name)) {
    return {
      avatarClass: 'avatar-fintech',
      iconClass: 'fa-solid fa-gears',
      domainTag: '<span class="hs-domain-tag tag-fintech"><i class="fa-solid fa-gears"></i> Aladdin &amp; FinTech</span>',
      headline: `Aladdin Wealth Tech &amp; platform engineering scaling with <strong>${total}</strong> live requisitions and <strong>${leadership} VP/Director-level leaders</strong>${hubText}.`,
    };
  }

  if (/northern\s*trust/i.test(name)) {
    return {
      avatarClass: 'avatar-core',
      iconClass: 'fa-solid fa-building',
      domainTag: '<span class="hs-domain-tag tag-core"><i class="fa-solid fa-building"></i> Core Banking Tech</span>',
      headline: `Accelerating direct-hire core banking modernization &amp; asset servicing technology with <strong>${total}</strong> engineering openings${hubText}.`,
    };
  }

  if (/vanguard/i.test(name)) {
    return {
      avatarClass: 'avatar-cloud',
      iconClass: 'fa-solid fa-cloud',
      domainTag: '<span class="hs-domain-tag tag-cloud"><i class="fa-solid fa-cloud"></i> Cloud &amp; Cyber</span>',
      headline: `Scaling enterprise cloud infrastructure, quantitative tech &amp; DevSecOps with <strong>${total}</strong> active roles across regional hubs.`,
    };
  }

  return {
    avatarClass: 'avatar-ai',
    iconClass: 'fa-solid fa-briefcase',
    domainTag: '<span class="hs-domain-tag"><i class="fa-solid fa-briefcase"></i> Talent Expansion</span>',
    headline: `Active enterprise talent expansion with <strong>${total}</strong> open requisitions, <strong>${leadership}</strong> leadership hires, and <strong>${summary.top_hubs?.length || 0}</strong> active tech hubs.`,
  };
}

function generateSalesActionStep(summary, account) {
  const name = getOrgShortName(account);
  const total = summary.total_roles || 0;
  const leadership = summary.leadership_count || 0;
  const contract = summary.contract_count || 0;
  const topCat = summary.top_category?.name || 'Engineering';
  const aiCount = summary.track_counts?.ai || 0;

  if (aiCount >= 10 || /bny|mellon/i.test(name)) {
    return {
      actionTitle: `Pitch AI Platform & LLMOps Staff-Aug`,
      targetRole: 'VP / Head of Enterprise AI',
      recommendation: `High AI hiring detected (${leadership} leadership roles). Pitch StradIT AI Governance Advisory & LLMOps squads before headcount closes.`,
      taskTitle: `Pitch AI Governance & Staff-Augmentation to ${name}`,
      taskDescription: `Target: VP of AI Engineering & Architecture.\nContext: ${total} open roles (${leadership} leadership in AI/ML).\nAction: Schedule briefing on enterprise AI governance & LLMOps team augmentation.`,
    };
  }

  if (/blackrock/i.test(name)) {
    return {
      actionTitle: `Position Aladdin Platform Decoupling`,
      targetRole: 'Director of Aladdin Wealth Tech',
      recommendation: `Aladdin engineering scaling (${total} live roles). Pitch specialized quantitative squads and legacy platform decoupling services.`,
      taskTitle: `Aladdin Platform Decoupling Outreach for ${name}`,
      taskDescription: `Target: Director of Aladdin Wealth Tech.\nContext: ${total} live requisitions in platform engineering.\nAction: Share StradIT quantitative architecture decoupling case study.`,
    };
  }

  if (/northern\s*trust/i.test(name)) {
    return {
      actionTitle: `Propose Asset Servicing Modernization`,
      targetRole: 'Head of Core Banking Technology',
      recommendation: `Core banking tech hiring active. Pitch asset servicing migration advisory & contract engineering squads to bridge hiring lag.`,
      taskTitle: `Core Banking Modernization Outreach for ${name}`,
      taskDescription: `Target: Head of Core Banking Tech.\nContext: ${total} open roles in asset servicing & core banking.\nAction: Propose legacy refactoring sprints and squad augmentation.`,
    };
  }

  if (/vanguard/i.test(name)) {
    return {
      actionTitle: `Pitch DevSecOps & Cloud Acceleration`,
      targetRole: 'Head of Cloud & DevSecOps',
      recommendation: `Cloud infrastructure & DevSecOps expanding. Propose automated security pipeline & multi-cloud consolidation services.`,
      taskTitle: `DevSecOps & Cloud Consolidation Outreach for ${name}`,
      taskDescription: `Target: Head of Cloud Infrastructure & DevSecOps.\nContext: ${total} active roles across quantitative & cloud engineering.\nAction: Share cloud security & DevSecOps accelerator case studies.`,
    };
  }

  if (contract > 0) {
    return {
      actionTitle: `Submit Contingent Squad Proposal`,
      targetRole: 'VP of Engineering / TAM Lead',
      recommendation: `${contract} contractor roles open. Submit pre-vetted senior squads for rapid onboarding to unblock deliverable timelines.`,
      taskTitle: `Contingent Squad Proposal for ${name}`,
      taskDescription: `Target: VP of Engineering / TAM.\nContext: ${contract} open contractor roles across tech hubs.\nAction: Submit StradIT rate cards & pre-vetted squad profiles for immediate interview.`,
    };
  }

  return {
    actionTitle: `Target Incoming Leaders on ${topCat}`,
    targetRole: `Director / VP of ${topCat}`,
    recommendation: `${leadership} open leadership roles in ${topCat}. Reach out during onboarding to position advisory consulting and team scaling.`,
    taskTitle: `Leadership Outreach on ${topCat} for ${name}`,
    taskDescription: `Target: Director / VP of ${topCat}.\nContext: ${total} open requisitions with active executive hiring in ${topCat}.\nAction: Schedule discovery call on project roadmap and engineering scaling needs.`,
  };
}

export async function renderHiringSignals() {
  const list = document.getElementById('ccHiringList');
  if (!list) return;

  list.innerHTML = renderSkeleton('feed-rows');

  try {
    // 1. Load all real accounts
    const allAccounts = await loadRealAccounts();
    if (!allAccounts || !allAccounts.length) {
      list.innerHTML = '<li class="cc-drawer-empty">No tracked organizations found in database.</li>';
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

    // 3. Render as an actionable tile grid with clear next action steps for sales reps
    list.classList.add('hs-tile-grid');
    list.innerHTML = activeOrgs.map(({ account, summary }) => {
      const shortName = getOrgShortName(account);
      const tickerTag = getOrgTickerTag(summary, account);
      const bulletin = generateNewsBulletin(summary, account);
      const actionStep = generateSalesActionStep(summary, account);
      const totalRoles = summary.total_roles || 0;
      const leadershipCount = summary.leadership_count || 0;
      const contractCount = summary.contract_count || 0;
      const topHubsCount = (summary.top_hubs || []).length;
      const thirdKpi = contractCount > 0
        ? { num: contractCount, label: 'Contract', highlight: true }
        : { num: topHubsCount, label: 'Hubs', highlight: false };

      return `
        <li class="hs-tile" data-account-id="${account.id}">
          <div class="hs-tile-head">
            <div class="hs-bulletin-avatar ${bulletin.avatarClass}">
              <i class="${bulletin.iconClass}"></i>
            </div>
            <div class="hs-tile-head-text">
              <div class="hs-tile-name">${esc(shortName)}</div>
              <div class="hs-tile-ticker">${esc(tickerTag)}</div>
            </div>
          </div>
          ${bulletin.domainTag}
          ${summary.top_category ? `
            <div class="hs-tile-top-category" title="${summary.top_category.count} of ${totalRoles.toLocaleString()} open roles are ${esc(summary.top_category.name)}">
              <i class="${summary.top_category.icon}"></i>
              <span>Mostly hiring: <strong>${esc(summary.top_category.name)}</strong></span>
              <span class="hs-tile-top-category-count">${summary.top_category.count}</span>
            </div>
          ` : ''}
          <div class="hs-tile-kpis">
            <div class="hs-tile-kpi">
              <div class="hs-tile-kpi-num">${totalRoles.toLocaleString()}</div>
              <div class="hs-tile-kpi-label">Roles</div>
            </div>
            <div class="hs-tile-kpi">
              <div class="hs-tile-kpi-num">${leadershipCount.toLocaleString()}</div>
              <div class="hs-tile-kpi-label">Leadership</div>
            </div>
            <div class="hs-tile-kpi ${thirdKpi.highlight ? 'hs-tile-kpi-highlight' : ''}">
              <div class="hs-tile-kpi-num">${thirdKpi.num.toLocaleString()}</div>
              <div class="hs-tile-kpi-label">${thirdKpi.label}</div>
            </div>
          </div>

          <!-- Action Step Box -->
          <div class="hs-action-box">
            <div class="hs-action-head">
              <span class="hs-action-pill"><i class="fa-solid fa-bolt"></i> NEXT ACTION</span>
              <span class="hs-action-target" title="Target Role: ${esc(actionStep.targetRole)}"><i class="fa-solid fa-user-check"></i> ${esc(actionStep.targetRole)}</span>
            </div>
            <div class="hs-action-text">${esc(actionStep.recommendation)}</div>
            <div class="hs-action-footer">
              <button type="button" class="cc-btn cc-btn-primary cc-btn-xs hs-task-btn" data-account-name="${esc(shortName)}" data-task-title="${esc(actionStep.taskTitle)}" data-task-desc="${esc(actionStep.taskDescription)}" title="Create assigned task in My Tasks">
                <i class="fa-solid fa-plus"></i> Create Action Task
              </button>
              <a class="hs-explore-link" href="/?account=${account.id}&tab=jobs" title="View all open requisitions">
                Requisitions <i class="fa-solid fa-arrow-right"></i>
              </a>
            </div>
          </div>
        </li>
      `;
    }).join('');

    // 4. Click handler: Create real task from action step
    list.querySelectorAll('.hs-task-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const accountName = btn.dataset.accountName;
        const taskTitle = btn.dataset.taskTitle;
        const taskDesc = btn.dataset.taskDesc;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating…';
        const ok = await createTask(accountName, taskTitle, { description: taskDesc, priority: 'high' });
        if (ok) {
          btn.classList.remove('cc-btn-primary');
          btn.classList.add('cc-btn-done');
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Task Created';
        } else {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-plus"></i> Create Action Task';
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

  container.innerHTML = renderSkeleton('cards');

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
      loadPersonas(accountId),
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
            <i class="fa-solid fa-microchip"></i> AI Hub &amp; Process Automation
          </div>
          <span class="pill pill-brand">${aiRolesCount} active roles</span>
        </div>

        <div class="cc-track-summary">
          Requisitions include <strong>SVP POM Product Management</strong>, <strong>AI Software Engineer</strong>, and <strong>AI Process Analyst</strong>.
        </div>

        <div class="cc-track-persona-box">
          <div class="cc-track-persona-head">
            <i class="fa-solid fa-id-badge"></i> Target Sponsoring Decision Maker
          </div>
          <div class="cc-track-persona-info">
            <strong>${esc(aiExecName)}</strong> — <span style="color:var(--text-secondary);">${esc(aiExecTitle)}</span>
          </div>
        </div>

        <div class="cc-track-pitch-box">
          <i class="fa-solid fa-bullseye"></i>
          <div>
            <strong>Recommended Pitch Play:</strong> StradIT Enterprise AI Governance, Agentic Workflow Orchestration, and LLMOps Advisory.
          </div>
        </div>
      </div>

      <!-- Track 2: Cloud & Full-Stack Modernization -->
      <div class="cc-track-card">
        <div class="cc-track-card-header">
          <div class="cc-track-badge track-cloud">
            <i class="fa-solid fa-cloud"></i> Cloud &amp; Full-Stack Modernization
          </div>
          <span class="pill pill-brand">${cloudRolesCount} active roles</span>
        </div>

        <div class="cc-track-summary">
          Requisitions include <strong>SVP Full-Stack Engineer</strong> (New York) and <strong>VP Full-Stack Engineer</strong> (Boston).
        </div>

        <div class="cc-track-persona-box">
          <div class="cc-track-persona-head">
            <i class="fa-solid fa-id-badge"></i> Target Sponsoring Decision Maker
          </div>
          <div class="cc-track-persona-info">
            <strong>${esc(cloudExecName)}</strong> — <span style="color:var(--text-secondary);">${esc(cloudExecTitle)}</span>
          </div>
        </div>

        <div class="cc-track-pitch-box">
          <i class="fa-solid fa-bullseye"></i>
          <div>
            <strong>Recommended Pitch Play:</strong> Hybrid Cloud Modernization, Legacy Decoupling, and SRE Scale.
          </div>
        </div>
      </div>
    </div>
  `;

  // Click handler to open account view
  container.querySelectorAll('.cc-track-card').forEach(card => {
    card.style.cursor = 'pointer';
    card.title = 'Click to view Strategic Personas and Account Details';
    card.addEventListener('click', () => {
      window.location.href = `/?account=${accountId}&tab=personas`;
    });
  });
}
