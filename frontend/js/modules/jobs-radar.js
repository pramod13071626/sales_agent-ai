// Organisational Hiring & Strategic Trend Radar Engine
// Dynamically extracts strategic domain investment, leadership expansion indices,
// tech stack signals, and actionable sales pitch triggers from live PostgreSQL job records.

import { esc, formatJobSalary, formatWeekOf } from './utils.js';
import { STRADIT_OFFERINGS } from './constants.js';

export const HIRING_DOMAINS = [
  {
    id: 'ai_automation',
    name: 'AI & Process Automation',
    icon: 'bi-cpu-fill',
    color: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    offerId: 'ai',
    keywords: [
      /\bai\b/i, /artificial intelligence/i, /machine learning/i, /\bml\b/i, /genai/i, /generative ai/i,
      /llm/i, /copilot/i, /process analyst/i, /deep learning/i, /nlp/i, /automation/i, /cognitive/i,
      /neural/i, /agentic/i, /prompt/i
    ],
    pitchAngle: 'Enterprise AI Governance, Agentic Workflow Orchestration, and LLMOps Advisory',
  },
  {
    id: 'cloud_platform',
    name: 'Cloud & Platform Modernization',
    icon: 'bi-cloud-check-fill',
    color: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
    offerId: 'cloud',
    keywords: [
      /cloud/i, /infrastructure/i, /full-stack/i, /full stack/i, /platform/i, /devops/i, /architect/i,
      /systems lead/i, /site reliability/i, /\bsre\b/i, /\baws\b/i, /\bazure\b/i, /\bgcp\b/i,
      /kubernetes/i, /microservices/i, /distributed systems/i, /software engineer/i
    ],
    pitchAngle: 'Hybrid Cloud Architecture Modernization, Legacy Decoupling, and SRE Scale',
  },
  {
    id: 'data_analytics',
    name: 'Data Engineering & Analytics',
    icon: 'bi-bar-chart-fill',
    color: 'linear-gradient(135deg, #10b981, #059669)',
    offerId: 'data',
    keywords: [
      /data/i, /quantitative/i, /analytics/i, /\bbi\b/i, /data science/i, /\betl\b/i, /\bsql\b/i,
      /snowflake/i, /databricks/i, /pipeline/i, /warehouse/i, /business intelligence/i, /lakehouse/i
    ],
    pitchAngle: 'Modern Data Stack Integration, Real-Time Analytics Pipelines, and Decision Intelligence',
  },
  {
    id: 'risk_compliance',
    name: 'Risk, Compliance & Control',
    icon: 'bi-shield-check',
    color: 'linear-gradient(135deg, #f59e0b, #d97706)',
    offerId: 'cyber',
    keywords: [
      /risk/i, /compliance/i, /control/i, /cyber/i, /security/i, /audit/i, /governance/i,
      /identity/i, /fraud/i, /surveillance/i, /regulatory/i, /collateral/i
    ],
    pitchAngle: 'Automated Regulatory Compliance Pipelines, Threat Intelligence, and Access Governance',
  },
  {
    id: 'core_operations',
    name: 'Core Business & Operations',
    icon: 'bi-diagram-3-fill',
    color: 'linear-gradient(135deg, #ec4899, #db2777)',
    offerId: null,
    keywords: [
      /product management/i, /\bpom\b/i, /operations/i, /credit/i, /investor services/i,
      /client processing/i, /custody/i, /asset servicing/i, /settlement/i, /trading/i,
      /wealth/i, /portfolio/i, /specialist/i, /accountant/i, /sales/i, /manager/i
    ],
    pitchAngle: 'Core Operational Streamlining, Asset Servicing Modernization, and Digital Front-Office Enablement',
  },
];

const TECH_CATALOG = [
  { name: 'AWS', rx: /\baws\b/i },
  { name: 'Azure', rx: /\bazure\b/i },
  { name: 'GCP', rx: /\b(gcp|google cloud)\b/i },
  { name: 'Kubernetes', rx: /\b(kubernetes|k8s)\b/i },
  { name: 'Docker', rx: /\bdocker\b/i },
  { name: 'Python', rx: /\bpython\b/i },
  { name: 'Java', rx: /\bjava\b/i },
  { name: 'React', rx: /\breact\b/i },
  { name: 'Angular', rx: /\bangular\b/i },
  { name: 'PyTorch', rx: /\bpytorch\b/i },
  { name: 'TensorFlow', rx: /\btensorflow\b/i },
  { name: 'Snowflake', rx: /\bsnowflake\b/i },
  { name: 'Databricks', rx: /\bdatabricks\b/i },
  { name: 'Kafka', rx: /\bkafka\b/i },
  { name: 'SQL', rx: /\bsql\b/i },
  { name: 'PostgreSQL', rx: /\b(postgres|postgresql)\b/i },
  { name: 'Terraform', rx: /\bterraform\b/i },
  { name: 'Spark', rx: /\bspark\b/i },
  { name: 'Hadoop', rx: /\bhadoop\b/i },
  { name: 'Node.js', rx: /\bnode(\.js)?\b/i },
  { name: 'Go', rx: /\b(golang|go language)\b/i },
  { name: 'C++', rx: /(?:^|\s|\W)c\+\+(?:$|\s|\W)/i },
  { name: 'Salesforce', rx: /\bsalesforce\b/i },
  { name: 'ServiceNow', rx: /\bservicenow\b/i }
];

export function analyzeHiringTrends(jobs, account) {
  const total = jobs.length;
  if (!total) {
    return {
      total: 0,
      domains: [],
      topDomain: null,
      leadershipCount: 0,
      leadershipPct: 0,
      leadershipRoles: [],
      topTech: [],
      topLocations: [],
      triggers: [],
      categorizedJobs: new Map(),
    };
  }

  // 1. Domain Categorization
  const categorizedJobs = new Map();
  HIRING_DOMAINS.forEach(d => categorizedJobs.set(d.id, []));

  jobs.forEach(j => {
    const text = `${j.title || ''} ${j.description || ''} ${j.employment_type || ''}`;
    let matched = false;
    for (const domain of HIRING_DOMAINS) {
      if (domain.keywords.some(regex => regex.test(text))) {
        categorizedJobs.get(domain.id).push(j);
        matched = true;
        break; // assign to primary dominant domain
      }
    }
    if (!matched) {
      categorizedJobs.get('core_operations').push(j);
    }
  });

  const domains = HIRING_DOMAINS.map(d => {
    const list = categorizedJobs.get(d.id) || [];
    const count = list.length;
    const pct = Math.round((count / total) * 100);
    let surgeBadge = { label: 'STEADY', icon: 'bi-check-circle', cssClass: 'surge-steady' };
    if (pct >= 30) {
      surgeBadge = { label: 'HIGH SURGE', icon: 'bi-fire', cssClass: 'surge-high' };
    } else if (pct >= 15) {
      surgeBadge = { label: 'ACTIVE', icon: 'bi-lightning-charge-fill', cssClass: 'surge-active' };
    }
    return {
      ...d,
      count,
      pct,
      surgeBadge,
      jobs: list,
    };
  }).filter(d => d.count > 0).sort((a, b) => b.count - a.count);

  const topDomain = domains.length ? domains[0] : null;

  // 2. Leadership Seniority Index
  const leadershipKeywords = [/director/i, /\bvp\b/i, /vice president/i, /\bsvp\b/i, /senior vice president/i, /head of/i, /chief/i, /lead/i, /principal/i];
  const leadershipRoles = jobs.filter(j => leadershipKeywords.some(rx => rx.test(j.title || '')));
  const leadershipCount = leadershipRoles.length;
  const leadershipPct = Math.round((leadershipCount / total) * 100);

  // 3. Tech Signals Extraction
  const techCounts = new Map();
  TECH_CATALOG.forEach(t => {
    let count = 0;
    jobs.forEach(j => {
      if (t.rx.test(j.title || '') || t.rx.test(j.description || '')) count++;
    });
    if (count > 0) techCounts.set(t.name, count);
  });
  const topTech = [...techCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tech, count]) => ({ tech, count }));

  // 4. Location Hubs
  const locCounts = new Map();
  jobs.forEach(j => {
    let loc = (j.location || '').trim();
    if (loc.includes('/')) loc = loc.split('/')[0].trim();
    if (loc) locCounts.set(loc, (locCounts.get(loc) || 0) + 1);
  });
  const topLocations = [...locCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([location, count]) => ({ location, count }));

  // 5. Dynamic Sales Triggers Formulation
  const triggers = [];
  const acctName = account.name || 'this enterprise';

  if (topDomain) {
    const matchedOffering = STRADIT_OFFERINGS.find(o => o.id === topDomain.offerId) || STRADIT_OFFERINGS[0];
    triggers.push({
      title: `Heavy Investment in ${topDomain.name} (${topDomain.pct}% of open requisitions)`,
      detail: `${acctName} has ${topDomain.count} open roles in ${topDomain.name.toLowerCase()}, indicating an active capital allocation and program buildout.`,
      pitch: `Pitch StradIT ${matchedOffering.label}: ${matchedOffering.pitch}`,
      talkingPoint: `We noticed ${acctName}'s substantial talent expansion in ${topDomain.name.toLowerCase()} (${topDomain.count} active postings). At StradIT, we help financial enterprises accelerate these exact initiatives through ${matchedOffering.pitch.toLowerCase()}`,
    });
  }

  if (leadershipCount > 0) {
    triggers.push({
      title: `Executive Leadership Expansion (${leadershipCount} Leadership & Lead Roles)`,
      detail: `${leadershipPct}% of active requisitions are VP, Director, or Lead positions, indicating new initiative formation and department scaling.`,
      pitch: 'Engage incoming leadership before vendor ecosystems and architectures are locked.',
      talkingPoint: `With ${leadershipCount} new VP and leadership appointments currently open across engineering and operations at ${acctName}, this is an ideal inflection point to establish benchmark consulting and advisory support.`,
    });
  }

  if (domains.length > 1) {
    const secondaryDomain = domains[1];
    const topHubStr = topLocations.slice(0, 2).map(l => `${l.location} (${l.count})`).join(', ');
    triggers.push({
      title: `Secondary Growth in ${secondaryDomain.name} (${secondaryDomain.count} roles)`,
      detail: `Expanding capabilities in ${secondaryDomain.name.toLowerCase()}${topHubStr ? ` across regional hubs (${topHubStr})` : ''}.`,
      pitch: `Align case studies on ${secondaryDomain.pitchAngle}.`,
      talkingPoint: `Regarding ${acctName}'s ongoing momentum in ${secondaryDomain.name.toLowerCase()}, StradIT brings pre-built accelerators for ${secondaryDomain.pitchAngle.toLowerCase()}.`,
    });
  }

  return {
    total,
    domains,
    topDomain,
    leadershipCount,
    leadershipPct,
    leadershipRoles,
    topTech,
    topLocations,
    triggers,
    categorizedJobs,
  };
}

export function renderHiringTrendRadar(account, jobs, activeFilter = 'all') {
  if (!jobs || !jobs.length) {
    return `
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-graph-up-arrow"></i> Organisational Hiring &amp; Strategic Trend Radar</span>
          <span class="context-badge">0 Open Roles</span>
        </div>
        <div class="empty-block" style="padding:36px 16px;">
          <div class="empty-block-icon"><i class="bi bi-briefcase"></i></div>
          <div class="empty-block-text">No active LinkedIn job postings recorded in the database for ${esc(account.name || 'this account')}.</div>
        </div>
      </div>
    `;
  }

  const analysis = analyzeHiringTrends(jobs, account);
  const { total, domains, topDomain, leadershipCount, leadershipPct, topTech, topLocations, triggers } = analysis;

  // Filter jobs based on activeFilter
  let filteredJobs = jobs;
  if (activeFilter === 'leadership') {
    filteredJobs = analysis.leadershipRoles;
  } else if (activeFilter !== 'all') {
    filteredJobs = analysis.categorizedJobs.get(activeFilter) || jobs;
  }

  const primaryHub = topLocations.length ? topLocations[0].location : 'Global';

  return `
    <div class="panel radar-container">
      <div class="panel-title">
        <div>
          <span><i class="bi bi-graph-up-arrow" style="color:var(--brand);"></i> Organisational Hiring &amp; Strategic Trend Radar</span>
          <p class="section-desc" style="margin:4px 0 0 0;">Dynamic intelligence derived from ${total} live requisitions in database for <strong>${esc(account.name)}</strong></p>
        </div>
        <span class="context-badge live"><i class="bi bi-layers-fill"></i> ${total} Total Roles Monitored</span>
      </div>

      <!-- Top 3 Strategic KPI Metric Cards -->
      <div class="radar-kpi-grid">
        <div class="radar-kpi-card">
          <div class="radar-kpi-header">
            <span class="radar-kpi-label">Top Booming Domain</span>
            <span class="radar-kpi-icon" style="color:#6366f1;"><i class="${topDomain ? topDomain.icon : 'bi-stars'}"></i></span>
          </div>
          <div class="radar-kpi-value">${topDomain ? esc(topDomain.name) : 'Balanced'}</div>
          <div class="radar-kpi-sub">
            <span class="pill pill-brand">${topDomain ? topDomain.pct : 0}% of active hiring</span>
            <span class="radar-surge-pill ${topDomain ? topDomain.surgeBadge.cssClass : ''}">${topDomain ? topDomain.surgeBadge.label : ''}</span>
          </div>
        </div>

        <div class="radar-kpi-card">
          <div class="radar-kpi-header">
            <span class="radar-kpi-label">Leadership Expansion</span>
            <span class="radar-kpi-icon" style="color:#0ea5e9;"><i class="bi bi-people-fill"></i></span>
          </div>
          <div class="radar-kpi-value">${leadershipCount} VP &amp; Lead Roles</div>
          <div class="radar-kpi-sub">
            <span class="pill pill-success">${leadershipPct}% leadership ratio</span>
            <span style="color:var(--text-muted); font-size:0.75rem;">New initiative formation</span>
          </div>
        </div>

        <div class="radar-kpi-card">
          <div class="radar-kpi-header">
            <span class="radar-kpi-label">Regional Footprint</span>
            <span class="radar-kpi-icon" style="color:#10b981;"><i class="bi bi-geo-alt-fill"></i></span>
          </div>
          <div class="radar-kpi-value">${topLocations.length} Active Regional Hubs</div>
          <div class="radar-kpi-sub">
            <span class="pill pill-success">${esc(primaryHub)} (Top Hub)</span>
            <span style="color:var(--text-muted); font-size:0.75rem;">${total} roles mapped across locations</span>
          </div>
        </div>
      </div>

      <!-- Dedicated Horizontal Primary Tech Stack & Regional Hubs Bar -->
      <div class="radar-tech-hubs-bar">
        <div class="radar-tech-col">
          <div class="radar-col-header">
            <span class="radar-col-title"><i class="bi bi-cpu-fill" style="color:var(--brand);"></i> Primary Tech Stack in Motion</span>
            <span class="radar-count-badge">${topTech.length} Detected</span>
          </div>
          <div class="radar-pill-row">
            ${topTech.length ? topTech.map(t => `
              <div class="radar-item-pill tech-pill" title="${t.count} requisitions require ${esc(t.tech)}">
                <i class="bi bi-check2-circle"></i>
                <strong>${esc(t.tech)}</strong>
                <span class="pill-badge">${t.count}</span>
              </div>
            `).join('') : '<div class="radar-empty-hint">Multi-stack enterprise technology environment</div>'}
          </div>
        </div>

        <div class="radar-hubs-col">
          <div class="radar-col-header">
            <span class="radar-col-title"><i class="bi bi-geo-alt-fill" style="color:#10b981;"></i> Regional Delivery &amp; CoE Hubs</span>
            <span class="radar-count-badge">${topLocations.length} Hubs</span>
          </div>
          <div class="radar-pill-row">
            ${topLocations.length ? topLocations.map(l => `
              <div class="radar-item-pill hub-pill" title="${l.count} requisitions in ${esc(l.location)}">
                <i class="bi bi-buildings"></i>
                <span>${esc(l.location)}</span>
                <span class="pill-badge">${l.count}</span>
              </div>
            `).join('') : '<div class="radar-empty-hint">Global distribution across enterprise locations</div>'}
          </div>
        </div>
      </div>

      <!-- 1. Domain Investment Distribution -->
      <div class="radar-section">
        <div class="radar-section-title">
          <i class="bi bi-bar-chart-steps"></i> Domain Investment Distribution
          <span style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-left:auto;">Click any bar to filter requisitions</span>
        </div>
        <div class="radar-bars-wrap">
          ${domains.map(d => `
            <div class="radar-bar-row ${activeFilter === d.id ? 'active' : ''}" data-radar-filter="${d.id}" title="Click to view ${d.count} ${esc(d.name)} roles">
              <div class="radar-bar-info">
                <span class="radar-bar-name"><i class="bi ${d.icon}"></i> ${esc(d.name)}</span>
                <div class="radar-bar-metrics">
                  <span class="radar-bar-pct"><strong>${d.pct}%</strong> (${d.count} roles)</span>
                  <span class="radar-surge-pill ${d.surgeBadge.cssClass}"><i class="bi ${d.surgeBadge.icon}"></i> ${d.surgeBadge.label}</span>
                </div>
              </div>
              <div class="radar-bar-track">
                <div class="radar-bar-fill" style="width:${d.pct}%; background:${d.color};"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 2. Strategic Sales Takeaways & Pitch Angles -->
      <div class="radar-section">
        <div class="radar-section-title">
          <i class="bi bi-lightbulb-fill" style="color:#eab308;"></i> Strategic Sales Takeaways &amp; Pitch Angles
        </div>
        <div class="radar-triggers-list">
          ${triggers.map((t, idx) => `
            <div class="radar-trigger-card">
              <div class="radar-trigger-head">
                <div class="radar-trigger-badge">Trigger ${idx + 1}</div>
                <div class="radar-trigger-title">${esc(t.title)}</div>
              </div>
              <div class="radar-trigger-detail">${esc(t.detail)}</div>
              <div class="radar-trigger-pitch">
                <span class="radar-pitch-tag"><i class="bi bi-bullseye"></i> Recommended Play</span>
                <span>${esc(t.pitch)}</span>
              </div>
              <div class="radar-trigger-actions">
                <button type="button" class="radar-copy-btn" data-talking-point="${esc(t.talkingPoint)}">
                  <i class="bi bi-clipboard-check"></i> Copy Executive Talking Point
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 3. Filterable Requisitions Explorer -->
      <div class="radar-section" id="radarRequisitionsSection">
        <div class="radar-section-title">
          <i class="bi bi-list-columns-reverse"></i> Live Requisitions Explorer
          <span class="context-badge live" style="margin-left:auto;">${filteredJobs.length} of ${total} Roles</span>
        </div>

        <div class="radar-filter-chips">
          <button type="button" class="radar-chip ${activeFilter === 'all' ? 'active' : ''}" data-radar-filter="all">
            All Roles <span class="tab-badge">${total}</span>
          </button>
          ${domains.map(d => `
            <button type="button" class="radar-chip ${activeFilter === d.id ? 'active' : ''}" data-radar-filter="${d.id}">
              <i class="bi ${d.icon}"></i> ${esc(d.name)} <span class="tab-badge">${d.count}</span>
            </button>
          `).join('')}
          ${leadershipCount > 0 ? `
            <button type="button" class="radar-chip ${activeFilter === 'leadership' ? 'active' : ''}" data-radar-filter="leadership">
              <i class="bi bi-award-fill"></i> Leadership Only <span class="tab-badge">${leadershipCount}</span>
            </button>
          ` : ''}
        </div>

        <div class="radar-jobs-list">
          ${filteredJobs.map(job => renderRadarJobCard(job)).join('')}
        </div>
      </div>

    </div>
  `;
}

function renderRadarJobCard(job) {
  const salaryText = formatJobSalary(job.salary);
  return `
    <div class="job-card radar-job-card">
      <div class="job-card-header">
        <div class="job-card-title-wrap">
          <div class="job-card-title">${esc(job.title || 'Untitled Role')}</div>
          <div class="job-card-company">
            <i class="bi bi-building"></i> ${esc(job.company_name || 'Enterprise')}
            ${job.location ? ` · <i class="bi bi-geo-alt"></i> ${esc(job.location)}` : ''}
          </div>
        </div>
        ${job.new_in_last_run ? '<span class="pill pill-success"><i class="bi bi-stars"></i> New</span>' : ''}
      </div>

      ${(job.employment_type || job.workplace_type || salaryText) ? `
        <div class="chip-row" style="margin:8px 0;">
          ${job.employment_type ? `<span class="chip">${esc(job.employment_type)}</span>` : ''}
          ${job.workplace_type ? `<span class="chip">${esc(job.workplace_type)}</span>` : ''}
          ${salaryText ? `<span class="chip"><i class="bi bi-cash-stack"></i> ${esc(salaryText)}</span>` : ''}
        </div>` : ''}

      <div class="job-card-meta">
        ${job.posted_date ? `<span><i class="bi bi-calendar3"></i> Posted ${esc(formatWeekOf(job.posted_date))}</span>` : ''}
        ${job.applicants != null ? `<span><i class="bi bi-people"></i> ${job.applicants} applicants</span>` : ''}
        ${job.views != null ? `<span><i class="bi bi-eye"></i> ${job.views} views</span>` : ''}
      </div>

      <div class="job-card-actions">
        ${job.job_url ? `<a href="${esc(job.job_url)}" target="_blank" rel="noopener" class="job-card-link"><i class="bi bi-box-arrow-up-right"></i> View LinkedIn Requisition</a>` : ''}
      </div>
    </div>
  `;
}
