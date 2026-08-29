(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const dashBody = el('dashBody');
  const dashNav = el('dashNav');
  const navCollapseBtn = el('navCollapseBtn');
  const navCollapseIcon = el('navCollapseIcon');
  const navTree = el('navTree');
  const navFilters = el('navFilters');
  const navSearch = el('navSearch');
  const navSearchClear = el('navSearchClear');
  const navSortSelect = el('navSortSelect');
  const navToggleAllTree = el('navToggleAllTree');
  const navDigestBtn = el('navDigestBtn');
  const navAccountCount = el('navAccountCount');
  const filterCountAll = el('filterCountAll');
  const topbarTicker = el('topbarTicker');
  const dashEmpty = el('dashEmpty');
  const dashContent = el('dashContent');
  const dashPeople = el('dashPeople');
  const toastEl = el('toast');
  const contactDrawer = el('contactDrawer');
  const drawerBackdrop = el('drawerBackdrop');
  const drawerTitle = el('drawerTitle');
  const drawerPinned = el('drawerPinned');
  const drawerBody = el('drawerBody');
  const signalModalBackdrop = el('signalModalBackdrop');
  const signalModalTitle = el('signalModalTitle');
  const signalModalBody = el('signalModalBody');

  // ── Global fetch-activity indicator ─────────────────────────
  // Wraps window.fetch so every network request in the app — current and future,
  // anywhere in this file — drives a top progress bar with no per-call-site instrumentation.
  const globalLoadingBar = el('globalLoadingBar');
  let inFlightRequests = 0;
  let loadingBarHideTimer = null;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    inFlightRequests++;
    if (globalLoadingBar) {
      clearTimeout(loadingBarHideTimer);
      globalLoadingBar.classList.remove('done');
      globalLoadingBar.classList.add('active');
    }
    return nativeFetch(...args).finally(() => {
      inFlightRequests = Math.max(0, inFlightRequests - 1);
      if (inFlightRequests === 0 && globalLoadingBar) {
        globalLoadingBar.classList.remove('active');
        globalLoadingBar.classList.add('done');
        loadingBarHideTimer = setTimeout(() => globalLoadingBar.classList.remove('done'), 400);
      }
    });
  };

  let accounts = [];
  let expandedAccountIds = new Set();
  let activeAccountId = null;
  let activeView = null; // null | 'allJobs' — a full-page view independent of the account/digest split
  let activeLobId = null;
  let activeSalesTab = 'briefing'; // 'briefing' | 'committee' | 'alerts' | 'financials' | 'social' | 'weekly' | 'jobs'
  let navFilter = 'all'; // 'all' | 'high_score' | 'signal_ready' | 'deep_org' | 'multi_lob'
  let navSort = 'score'; // 'score' | 'name' | 'contacts' | 'recent'
  let extraTech = {}; // accountId -> [] technologies fetched live via Diffbot, not persisted
  let currentPersonas = []; // personas currently rendered in the right panel, indexed for the drawer
  let currentSignals = []; // Account Signals currently rendered in the center panel, indexed for the modal
  let allAccountPersonas = []; // unfiltered persona list for the currently rendered right panel, for search
  let contentStore = { digests: {}, posts: {}, jobs: {} }; // real scraped posts, LLM digests + LinkedIn job postings, keyed by target_key
  let opportunityHistory = {}; // accountId -> { growth_theme: [signal...], domain_expansion: [signal...] }, synced from the backend
  let weeklyUpdateHistory = {}; // accountId -> [weekly update snapshot...] newest first, synced from the backend
  let allJobsCache = null; // latest page response from GET /api/linkedin-jobs — server-side filtered/sorted/paginated, refetched whenever a filter or page changes
  let activeJobCategory = 'All';
  let activeJobSearch = '';
  let activeJobEmploymentType = '';
  let activeJobWorkplaceType = '';
  let activeJobSort = 'newest';
  let activeJobPage = 1;
  const JOB_PAGE_SIZE = 24;
  let jobsLoading = false;
  let jobSearchDebounceTimer = null;
  let activeJobDetailId = null; // set when a job card is opened on the All Jobs page — shows an in-page detail view instead of a modal
  let jobDetailCache = {}; // job id -> full detail (incl. description), fetched on demand from GET /api/linkedin-jobs/{id}

  const DIGEST_SECTIONS = [
    { id: 'step_guide', label: 'Workflow Guide Bar', icon: 'bi-signpost-split', desc: 'Step-by-step 4-step sales exploration guide' },
    { id: 'recently_updated', label: 'Recently Updated Accounts', icon: 'bi-clock-history', desc: 'Accounts with fresh scrapes & pipeline updates' },
    { id: 'most_mapped', label: 'Most-Mapped Accounts', icon: 'bi-people-fill', desc: 'Deepest organizational charts and contact coverage' },
    { id: 'social_digest', label: 'Social & Content Intelligence', icon: 'bi-broadcast-pin', desc: 'Captured social discourse & LLM synthesized themes' },
    { id: 'sales_alerts', label: 'Global Sales Alerts (StradIT Fit)', icon: 'bi-lightning-charge-fill', desc: 'AI service alignment opportunities across accounts' },
    { id: 'domain_expansion', label: 'Emerging Domain Expansion', icon: 'bi-rocket-takeoff-fill', desc: 'Trending enterprise tech initiatives & custom solutions' },
    { id: 'linkedin_jobs', label: 'Recent LinkedIn Job Postings', icon: 'bi-linkedin', desc: 'Newest scraped job postings across all tracked accounts' }
  ];

  let digestSectionVisibility = loadDigestSectionVisibility();

  function loadDigestSectionVisibility() {
    const defaults = {
      step_guide: true,
      recently_updated: true,
      most_mapped: true,
      social_digest: true,
      sales_alerts: true,
      domain_expansion: true,
      linkedin_jobs: true
    };
    try {
      const saved = localStorage.getItem('dash_digest_section_visibility');
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Could not read digest section visibility from localStorage', e);
    }
    return defaults;
  }

  function saveDigestSectionVisibility() {
    try {
      localStorage.setItem('dash_digest_section_visibility', JSON.stringify(digestSectionVisibility));
    } catch (e) {
      console.warn('Could not save digest section visibility to localStorage', e);
    }
  }

  const CHANNEL_ICON = {
    linkedin: 'bi-linkedin', twitter: 'bi-twitter-x', reddit: 'bi-reddit',
    news: 'bi-newspaper', blog: 'bi-journal-richtext', newsroom: 'bi-megaphone',
    sec: 'bi-bank', sec_mentions: 'bi-bank', rss: 'bi-rss'
  };
  const CHANNEL_LABEL = {
    linkedin: 'LinkedIn', twitter: 'X / Twitter', reddit: 'Reddit',
    news: 'News', blog: 'Blog', newsroom: 'Newsroom', sec: 'SEC Filings',
    sec_mentions: 'SEC Mentions', rss: 'RSS'
  };
  const STRENGTH_PILL = { weak: 'pill-warning', moderate: 'pill-warning', strong: 'pill-success' };

  // StradIT's real service lines (scraped from stradit.com/coe/* — Aug 2026), used to
  // match against real captured account/contact signals below. Keyword-matched with cited
  // evidence, never an invented "AI insight" — if nothing matches, nothing is shown.
  const STRADIT_OFFERINGS = [
    {
      id: 'ai', label: 'Applied AI', icon: 'bi-cpu-fill',
      pitch: 'AI governance, LLMOps, and production-grade AI agents/copilots.',
      keywords: [/artificial intelligence/i, /\bai\b/i, /\bllm\b/i, /generative ai/i, /genai/i, /machine learning/i, /\bml\b/i, /copilot/i, /\bagent/i, /agentic/i, /guardrail/i, /knowledge graph/i, /chatbot/i],
      roleKeywords: [/chief technology/i, /\bcto\b/i, /chief data/i, /\bcdo\b/i, /chief information officer/i, /\bcio\b/i, /chief digital/i, /chief innovation/i, /head of (ai|technology|data|innovation)/i],
      looseRoleKeywords: [/technology/i, /digital/i, /data/i, /innovation/i]
    },
    {
      id: 'data', label: 'Data Analytics', icon: 'bi-bar-chart-fill',
      pitch: 'Data integration, predictive intelligence, and decision-intelligence dashboards.',
      keywords: [/data quality/i, /data integration/i, /predictive/i, /forecast/i, /dashboard/i, /analytics/i, /business intelligence/i, /decision intelligence/i, /\breporting\b/i],
      roleKeywords: [/chief data/i, /\bcdo\b/i, /head of (data|analytics)/i, /chief analytics/i, /data officer/i],
      looseRoleKeywords: [/data/i, /analytics/i]
    },
    {
      id: 'cyber', label: 'Cybersecurity', icon: 'bi-shield-lock-fill',
      pitch: 'AI-enhanced security engineering, managed threat monitoring, and compliance readiness.',
      keywords: [/cyber/i, /security/i, /breach/i, /ransomware/i, /\bthreat/i, /vulnerabilit/i, /incident response/i, /data protection/i, /identity management/i],
      roleKeywords: [/chief information security/i, /\bciso\b/i, /head of security/i, /chief security/i, /security officer/i],
      looseRoleKeywords: [/security/i, /risk/i]
    },
    {
      id: 'cloud', label: 'Cloud & Infrastructure', icon: 'bi-cloud-fill',
      pitch: 'Multi-cloud migration, legacy modernization, and 24/7 managed cloud operations.',
      keywords: [/cloud migration/i, /\bcloud\b/i, /\baws\b/i, /\bazure\b/i, /\bgcp\b/i, /data cent(re|er)/i, /modernization/i, /multi-cloud/i, /legacy system/i, /\binfrastructure\b/i],
      roleKeywords: [/chief technology/i, /\bcto\b/i, /chief information officer/i, /\bcio\b/i, /head of (infrastructure|engineering|technology)/i, /vp.*engineering/i],
      looseRoleKeywords: [/technology/i, /infrastructure/i, /engineering/i, /operations/i]
    },
    {
      id: 'testing', label: 'Automated AI Testing', icon: 'bi-check2-square',
      pitch: 'AI-powered test automation and quality engineering frameworks.',
      keywords: [/\bqa\b/i, /quality engineering/i, /test automation/i, /ci\/cd/i, /release readiness/i, /\bdefect/i],
      roleKeywords: [/head of (quality|engineering)/i, /vp.*engineering/i, /chief technology/i, /\bcto\b/i, /quality assurance/i],
      looseRoleKeywords: [/quality/i, /engineering/i]
    },
    {
      id: 'digital_assets', label: 'Digital Assets & Blockchain', icon: 'bi-currency-bitcoin',
      pitch: 'Regulated tokenization, custody infrastructure, and smart-contract lifecycle management.',
      keywords: [/tokeniz/i, /\btoken\b/i, /blockchain/i, /digital asset/i, /stablecoin/i, /smart contract/i, /distributed ledger/i, /\bdlt\b/i, /\bcustody\b/i, /\bmica\b/i, /\bsettlement\b/i],
      roleKeywords: [/digital asset/i, /blockchain/i, /chief digital/i, /chief innovation/i, /head of (digital|innovation)/i],
      looseRoleKeywords: [/digital/i, /innovation/i, /custody/i]
    }
  ];

  function findPersonaLob(account, persona) {
    return (account.lobs || []).find(l => (l.personas || []).some(p => p.name === persona.name)) || null;
  }

  function tierLabel(p) {
    const t = (p.tier || '').toLowerCase().replace(/[_\s-]+/g, ' ').trim();
    if (t.includes('c suite') || t === 'csuite') return 'C-Suite';
    if (t.includes('vp') || t.includes('vice president')) return 'VP';
    if (t.includes('director')) return 'Director';
    if (t.includes('manager')) return 'Manager';
    return t ? t.replace(/\b\w/g, c => c.toUpperCase()) : 'Other';
  }

  function buildHierarchyGroups(personas) {
    const TIER_ORDER = ['C-Suite', 'VP', 'Director', 'Manager'];
    const groups = {};
    personas.forEach(p => { const label = tierLabel(p); (groups[label] = groups[label] || []).push(p); });
    const orderedLabels = [...TIER_ORDER.filter(l => groups[l]), ...Object.keys(groups).filter(l => !TIER_ORDER.includes(l))];
    return orderedLabels.map(label => ({
      label,
      people: groups[label].sort((a, b) => (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99))
    }));
  }

  function buildAlertHierarchy(account, rec) {
    let scopeName, personas, subLobs = [];
    const lobObj = rec.lob ? (account.lobs || []).find(l => l.name === rec.lob) : null;
    if (lobObj) {
      personas = dedupePersonas(lobObj.personas || []);
      subLobs = lobObj.subLobs || [];
      scopeName = lobObj.name;
    } else {
      personas = dedupePersonas(account.personas || []);
      scopeName = `${account.name} (Corporate / Group level)`;
    }
    return { scopeName, subLobs, isLob: !!lobObj, groups: buildHierarchyGroups(personas), total: personas.length, accountId: account.id };
  }

  function renderAlertHierarchy(h) {
    if (!h.total) return '';
    return `
      <details class="alert-hierarchy">
        <summary>Org hierarchy — ${esc(h.scopeName)} (${h.total} contact${h.total !== 1 ? 's' : ''})</summary>
        ${h.isLob ? (h.subLobs.length
          ? `<div class="chip-row" style="margin:8px 0;">${h.subLobs.map(s => `<span class="chip"><i class="bi bi-diagram-2"></i> ${esc(s.name)}</span>`).join('')}</div>`
          : `<div class="hierarchy-note"><i class="bi bi-info-circle"></i> No sub-divisions mapped for this LOB.</div>`) : ''}
        ${h.groups.map(g => `
          <div class="hierarchy-group">
            <div class="hierarchy-group-label">${esc(g.label)} <span class="hierarchy-group-count">${g.people.length}</span></div>
            <div class="hierarchy-group-people">
              ${g.people.map(p => `<button type="button" class="hierarchy-person" title="${esc(p.title || '')} — click to view full details" data-account-id="${h.accountId}" data-persona-id="${p.id}">${esc(p.name)}</button>`).join('')}
            </div>
          </div>`).join('')}
      </details>
    `;
  }

  function handleHierarchyPersonClick(e) {
    const btn = e.target.closest('.hierarchy-person');
    if (!btn) return;
    const account = accounts.find(a => a.id === Number(btn.dataset.accountId));
    if (!account) return;
    const persona = dedupePersonas(account.personas || []).find(p => p.id === Number(btn.dataset.personaId));
    if (persona) openContactDrawer(persona);
  }
  dashContent.addEventListener('click', handleHierarchyPersonClick);
  dashEmpty.addEventListener('click', handleHierarchyPersonClick);

  function handleOrgChartClick(e) {
    const btn = e.target.closest('.orgchart-node');
    if (!btn) return;
    const account = accounts.find(a => a.id === activeAccountId);
    if (!account) return;
    const persona = dedupePersonas(account.personas || []).find(p => p.name === btn.dataset.personaName);
    if (persona) {
      signalModalBackdrop.classList.remove('open');
      openContactDrawer(persona);
    } else {
      showToast(`${btn.dataset.personaName} isn't in the mapped contacts list yet.`);
    }
  }
  dashContent.addEventListener('click', handleOrgChartClick);
  signalModalBody.addEventListener('click', handleOrgChartClick);

  function recommendContact(offering, account, evidence) {
    const personas = dedupePersonas(account.personas || []);
    if (!personas.length) return null;

    function withLob(persona, reason) {
      const lob = findPersonaLob(account, persona);
      return { persona, reason, lob: lob ? lob.name : null };
    }

    if (evidence && evidence.person) {
      const match = personas.find(p => p.name === evidence.person);
      if (match) return withLob(match, 'Already posting about this topic');
    }

    const roleMatches = personas.filter(p => p.title && offering.roleKeywords.some(rx => rx.test(p.title)));
    if (roleMatches.length) {
      roleMatches.sort((a, b) => (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99));
      return withLob(roleMatches[0], 'Best-fit role for this service line');
    }

    const looseMatches = personas.filter(p => p.title && (offering.looseRoleKeywords || []).some(rx => rx.test(p.title)));
    if (looseMatches.length) {
      looseMatches.sort((a, b) => (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99));
      return withLob(looseMatches[0], 'Loosely related role — no dedicated specialist found');
    }

    const bySeniority = [...personas].sort((a, b) => {
      const aC = (a.tier || '').toLowerCase().includes('c-suite') || (a.tier || '').toLowerCase() === 'c_suite' ? 0 : 1;
      const bC = (b.tier || '').toLowerCase().includes('c-suite') || (b.tier || '').toLowerCase() === 'c_suite' ? 0 : 1;
      if (aC !== bC) return aC - bC;
      return (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99);
    });
    return withLob(bySeniority[0], 'No specialist mapped yet — start at the top of the org');
  }

  function buildContentEntries(targetKey) {
    const entries = [];
    const d = contentStore.digests[targetKey];
    if (d && !isDryRunDigest(d)) {
      (d.digest.channels || []).forEach(ch => {
        if (ch.summary) entries.push({ text: ch.summary, channel: ch.channel });
        (ch.themes || []).forEach(t => entries.push({ text: t, channel: ch.channel }));
        (ch.observed || []).forEach(o => entries.push({ text: o.fact, url: o.source_url, channel: ch.channel }));
        if (ch.sales_angle) entries.push({ text: ch.sales_angle, channel: ch.channel });
        if (ch.interpretation) entries.push({ text: ch.interpretation, channel: ch.channel });
      });
    }
    (contentStore.posts[targetKey] || []).forEach(p => {
      if (p.body) entries.push({ text: p.body, url: p.post_url, channel: p.channel });
    });
    return entries;
  }

  function getAccountContentEntries(account) {
    let entries = [];
    const acctKey = resolveAccountTargetKey(account);
    if (acctKey) entries = entries.concat(buildContentEntries(acctKey));
    (account.personas || []).forEach(p => {
      const pk = resolvePersonaTargetKey(p);
      if (pk) entries = entries.concat(buildContentEntries(pk).map(e => ({ ...e, person: p.name })));
    });
    return entries;
  }

  function matchOfferings(entries) {
    const matches = [];
    STRADIT_OFFERINGS.forEach(off => {
      let hitCount = 0;
      let evidence = null;
      entries.forEach(e => {
        if (off.keywords.some(rx => rx.test(e.text))) {
          hitCount++;
          if (!evidence) evidence = e;
        }
      });
      if (hitCount > 0) matches.push({ ...off, hitCount, evidence });
    });
    return matches.sort((a, b) => b.hitCount - a.hitCount);
  }

  function renderAlertCards(matches, opts) {
    opts = opts || {};
    if (!matches.length) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-bell-slash"></i></div>
        <div class="empty-block-text">${esc(opts.emptyText || "Captured content doesn't reference any StradIT service line yet.")}</div>
      </div>`;
    }
    return matches.map(m => {
      const ev = m.evidence;
      const snippet = ev.text.length > 180 ? ev.text.slice(0, 180) + '…' : ev.text;
      const evMeta = [ev.account, ev.person, ev.channel ? (CHANNEL_LABEL[ev.channel] || ev.channel) : null].filter(Boolean).join(' · ');
      const accountCount = m.accountIds ? new Set(m.accountIds).size : null;
      const matchAccount = opts.getAccount ? opts.getAccount(m) : null;
      const rec = matchAccount ? recommendContact(m, matchAccount, ev) : null;

      return `
        <div class="alert-card">
          <div class="alert-header">
            <i class="bi ${m.icon}"></i>
            <span class="alert-title">${esc(m.label)} opportunity</span>
            ${accountCount ? `<span class="pill">${accountCount} account${accountCount !== 1 ? 's' : ''}</span>` : ''}
            <span class="pill pill-brand">${m.hitCount} signal${m.hitCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="alert-pitch">${esc(m.pitch)}</div>
          <div class="alert-evidence">
            <i class="bi bi-quote"></i> ${esc(snippet)}
            ${evMeta ? `<span class="alert-evidence-meta">— ${esc(evMeta)}</span>` : ''}
            ${ev.url ? `<a href="${esc(ev.url)}" target="_blank"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
          </div>
          ${rec ? renderAlertHierarchy(buildAlertHierarchy(matchAccount, rec)) : (matchAccount ? `
            <div class="alert-contact alert-contact-empty">
              <i class="bi bi-person-x"></i> No contacts mapped for ${esc(matchAccount.name)} yet — fetch personas in the Account Explorer first.
            </div>` : '')}
          ${ev.accountId != null ? `<button type="button" class="alert-view-account" data-jump-account="${ev.accountId}">Open ${esc(ev.account || 'account')} <i class="bi bi-arrow-right"></i></button>` : ''}
        </div>`;
    }).join('');
  }

  function renderSalesAlerts(account) {
    const entries = getAccountContentEntries(account);
    if (!entries.length) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-bell-slash"></i></div>
        <div class="empty-block-text">No captured content yet to match against StradIT's service lines.</div>
      </div>`;
    }
    return renderAlertCards(matchOfferings(entries), { getAccount: () => account });
  }

  function renderGlobalSalesAlerts() {
    let entries = [];
    accounts.forEach(a => {
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
      getAccount: (m) => accounts.find(a => a.id === m.evidence.accountId)
    });
  }

  function computeGrowthOpportunities(account) {
    const themeMap = new Map(); // theme text -> { count, channels:Set, summary, person }
    const allKeywords = STRADIT_OFFERINGS.flatMap(off => off.keywords);

    function collectFromTargetKey(targetKey, personName) {
      const d = contentStore.digests[targetKey];
      if (!d || isDryRunDigest(d)) return;
      (d.digest.channels || []).forEach(ch => {
        (ch.themes || []).forEach(theme => {
          if (allKeywords.some(rx => rx.test(theme))) return; // already served by an existing offering
          if (!themeMap.has(theme)) themeMap.set(theme, { count: 0, channels: new Set(), summary: ch.summary, person: personName });
          const entry = themeMap.get(theme);
          entry.count++;
          entry.channels.add(ch.channel);
        });
      });
    }

    const acctKey = resolveAccountTargetKey(account);
    if (acctKey) collectFromTargetKey(acctKey);
    (account.personas || []).forEach(p => {
      const pk = resolvePersonaTargetKey(p);
      if (pk) collectFromTargetKey(pk, p.name);
    });

    return [...themeMap.entries()]
      .map(([theme, info]) => ({ theme, signalKey: slugify(theme), ...info }))
      .sort((a, b) => b.count - a.count);
  }

  function suggestGrowthProductIdea(theme) {
    return `Potential build: a scoped StradIT engagement (discovery workshop + pilot deliverable) addressing "${theme}" as a net-new custom service line for this account.`;
  }

  // ── Shared history badge + card chrome for both opportunity panels ──
  function renderHistoryBadge(historyEntry) {
    if (!historyEntry) return '';
    if (historyEntry.is_new) return '<span class="pill pill-success"><i class="bi bi-stars"></i> New</span>';
    if (historyEntry.status === 'inactive') return '<span class="pill pill-muted"><i class="bi bi-clock-history"></i> No longer trending</span>';
    return '';
  }

  function renderGrowthOpportunities(account, historySignals) {
    const opportunities = computeGrowthOpportunities(account);
    const historyByKey = new Map((historySignals || []).map(s => [s.signal_key, s]));
    // Merge in historical (inactive) themes not present in the live compute, so nothing detected in the past silently disappears.
    const liveKeys = new Set(opportunities.map(o => o.signalKey));
    const historicalOnly = (historySignals || [])
      .filter(s => s.status === 'inactive' && !liveKeys.has(s.signal_key))
      .map(s => ({
        theme: s.title, signalKey: s.signal_key,
        count: s.details.count || 0,
        channels: new Set(s.details.channels || []),
        summary: s.details.summary, person: s.details.person
      }));
    const combined = [...opportunities, ...historicalOnly];

    if (!combined.length) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-compass"></i></div>
        <div class="empty-block-text">No recurring unserved themes detected yet for this account.</div>
      </div>`;
    }
    return combined.map(o => `
      <div class="opportunity-card">
        <div class="opportunity-header">
          <i class="bi bi-compass"></i>
          <span class="opportunity-title">${esc(o.theme)}</span>
          ${o.count ? `<span class="pill pill-warning">${o.count} mention${o.count !== 1 ? 's' : ''}</span>` : ''}
          ${renderHistoryBadge(historyByKey.get(o.signalKey))}
        </div>
        <div class="opportunity-note">
          Not covered by any current StradIT service line${o.channels && o.channels.size ? ` — recurring in ${[...o.channels].map(c => esc(CHANNEL_LABEL[c] || c)).join(', ')}` : ''}${o.person ? ` (via ${esc(o.person)})` : ''}.
        </div>
        <div class="opportunity-idea"><i class="bi bi-lightbulb"></i> ${esc(suggestGrowthProductIdea(o.theme))}</div>
        ${o.summary ? `<div class="opportunity-evidence"><i class="bi bi-quote"></i> ${esc(o.summary.length > 160 ? o.summary.slice(0, 160) + '…' : o.summary)}</div>` : ''}
      </div>`).join('');
  }

  function computeDomainExpansionOpportunities(account) {
    const opportunities = [];
    const personas = dedupePersonas(account.personas || []);
    const lobs = account.lobs || [];
    const techSet = new Set();
    lobs.forEach(l => (l.technologies || []).forEach(t => techSet.add(t.toLowerCase())));

    // 1. Digital Assets, Tokenization & Settlement
    const hasDigitalAssets = lobs.some(l => /nominee|investment|fund|pershing/i.test(l.name)) || personas.some(p => /market|trade|investment/i.test(p.title || ''));
    if (hasDigitalAssets) {
      const sponsor = personas.find(p => /global markets|digital|innovation|technology/i.test(p.title || '')) || personas[0];
      opportunities.push({
        id: 'tokenization',
        title: 'Institutional Tokenization & Digital Asset Custody Engine',
        domain: 'Digital Assets & Web3 Integration',
        icon: 'bi-currency-bitcoin',
        status: 'High Demand in Enterprise',
        statusClass: 'pill-brand',
        demandSignal: 'Active market shift towards tokenized institutional collateral, digital custody, and real-time ledger settlement rails.',
        synergyAngle: 'StradIT can bridge existing AI governance & secure cloud infrastructure with custom smart-contract audit & tokenized custody APIs.',
        proposedScope: 'Deliver a 6-week POC on AI-assisted transaction reconciliation and multi-signature smart-contract lifecycle compliance.',
        sponsorName: sponsor ? sponsor.name : 'Head of Global Markets / CDO',
        sponsorTitle: sponsor ? (sponsor.title || 'Executive Leader') : 'Digital Innovation Leader'
      });
    }

    // 2. Quantum-Safe Cryptography & Post-Quantum Cyber Defense
    const hasSecurityMandate = account.company_type === 'Public' || /bank|financial|mellon/i.test(account.name);
    if (hasSecurityMandate) {
      const secSponsor = personas.find(p => /security|ciso|risk|technology advisory|infrastructure/i.test(p.title || '')) || personas.find(p => (p.tier || '').toLowerCase().includes('c')) || personas[0];
      opportunities.push({
        id: 'pqc',
        title: 'Post-Quantum Cryptography (PQC) & NIST Migration Readiness',
        domain: 'Next-Gen Cyber & Zero-Trust',
        icon: 'bi-shield-check',
        status: 'Emerging Regulatory Mandate',
        statusClass: 'pill-success',
        demandSignal: 'Upcoming federal and regulatory directives requiring financial institutions to inventory cryptographic assets for quantum resistance.',
        synergyAngle: 'Leverage StradIT AI-driven static code analysis and test automation to scan enterprise repositories for deprecated cipher suites.',
        proposedScope: 'Automated cryptographic discovery scan across core service repositories and post-quantum transition roadmap definition.',
        sponsorName: secSponsor ? secSponsor.name : 'CISO / Head of Security Engineering',
        sponsorTitle: secSponsor ? (secSponsor.title || 'Chief Information Security Officer') : 'Security Engineering Lead'
      });
    }

    // 3. Intelligent Core Event-Driven Microservices Refactoring
    if (lobs.length > 2 || account.employee_count_range) {
      const appSponsor = personas.find(p => /application|engineering|scrum|project lead/i.test(p.title || '')) || personas[0];
      opportunities.push({
        id: 'core_modernization',
        title: 'Intelligent Event-Driven Microservices & Legacy Core De-Coupling',
        domain: 'Cloud Architecture & Modernization',
        icon: 'bi-diagram-3-fill',
        status: 'Active Multi-LOB Modernization',
        statusClass: 'pill-warning',
        demandSignal: 'Managing disparate operating divisions requiring decoupled real-time event streaming and zero-downtime message orchestration.',
        synergyAngle: 'Pair StradIT cloud engineering with automated AI testing pipelines to extract business rules from legacy services safely.',
        proposedScope: 'Domain-Driven Design (DDD) workshop and scaffolding of an event-driven Kafka/cloud microservices bridge for clearance modules.',
        sponsorName: appSponsor ? appSponsor.name : 'VP Lead Applications',
        sponsorTitle: appSponsor ? (appSponsor.title || 'Lead Application Manager / VP') : 'Enterprise Engineering Director'
      });
    }

    return opportunities;
  }

  function renderDomainExpansionOpportunities(account, historySignals) {
    const opportunities = computeDomainExpansionOpportunities(account);
    const historyByKey = new Map((historySignals || []).map(s => [s.signal_key, s]));
    const liveKeys = new Set(opportunities.map(o => o.id));
    const historicalOnly = (historySignals || [])
      .filter(s => s.status === 'inactive' && !liveKeys.has(s.signal_key))
      .map(s => ({ id: s.signal_key, title: s.title, ...s.details }));
    const combined = [...opportunities, ...historicalOnly];

    if (!combined.length) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-layers"></i></div>
        <div class="empty-block-text">No custom capability expansion domains defined yet for this account.</div>
      </div>`;
    }
    return combined.map(o => `
      <div class="opportunity-card opportunity-card-brand">
        <div class="opportunity-header">
          <i class="bi ${esc(o.icon || 'bi-layers')}"></i>
          <span class="opportunity-title">${esc(o.title)}</span>
          ${o.status ? `<span class="pill ${esc(o.statusClass || 'pill-brand')}">${esc(o.status)}</span>` : ''}
          ${renderHistoryBadge(historyByKey.get(o.id))}
        </div>
        ${o.domain ? `<div class="opportunity-note"><strong>${esc(o.domain)}</strong>${o.demandSignal ? ` — ${esc(o.demandSignal)}` : ''}</div>` : ''}
        ${o.proposedScope ? `<div class="opportunity-idea"><i class="bi bi-lightbulb"></i> <strong>Suggested build:</strong> ${esc(o.proposedScope)}</div>` : ''}
        ${o.synergyAngle ? `<div class="opportunity-evidence"><i class="bi bi-quote"></i> ${esc(o.synergyAngle)}</div>` : ''}
        ${o.sponsorName ? `<div class="opportunity-sponsor"><i class="bi bi-person-badge"></i> Likely sponsor: ${esc(o.sponsorName)}${o.sponsorTitle ? ` — ${esc(o.sponsorTitle)}` : ''}</div>` : ''}
      </div>`).join('');
  }

  // Persists the currently-computed growth-theme & domain-expansion suggestions for an account so
  // they accumulate as history server-side, then repaints the two panels with new/historical badges.
  async function syncOpportunitySignals(account) {
    const growthItems = computeGrowthOpportunities(account).map(o => ({
      signal_key: o.signalKey,
      title: o.theme,
      details: { count: o.count, channels: [...o.channels], summary: o.summary, person: o.person }
    }));
    const domainItems = computeDomainExpansionOpportunities(account).map(o => ({
      signal_key: o.id,
      title: o.title,
      details: o
    }));
    let growthData = null, domainData = null;
    try {
      const [growthRes, domainRes] = await Promise.all([
        fetch(`/api/accounts/${account.id}/opportunities/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: 'growth_theme', items: growthItems })
        }),
        fetch(`/api/accounts/${account.id}/opportunities/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: 'domain_expansion', items: domainItems })
        })
      ]);
      if (growthRes.ok) growthData = await growthRes.json();
      if (domainRes.ok) domainData = await domainRes.json();
    } catch (err) {
      console.error('Opportunity signal sync failed', err);
      return;
    }
    opportunityHistory[account.id] = {
      growth_theme: growthData ? growthData.signals : [],
      domain_expansion: domainData ? domainData.signals : []
    };
    if (activeAccountId === account.id && activeSalesTab === 'alerts') {
      const growthBody = el('growthOpportunitiesBody');
      const domainBody = el('domainExpansionBody');
      if (growthBody) growthBody.innerHTML = renderGrowthOpportunities(account, opportunityHistory[account.id].growth_theme);
      if (domainBody) domainBody.innerHTML = renderDomainExpansionOpportunities(account, opportunityHistory[account.id].domain_expansion);
    }
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = (s == null ? '' : String(s));
    return d.innerHTML;
  }
  function initials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  function slugify(s) {
    return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function isDryRunDigest(entry) {
    if (!entry) return true;
    if (/dry.?run/i.test(entry.llm || '')) return true;
    if (entry.digest && entry.digest.email && entry.digest.email.dry_run === true) return true;
    return false;
  }
  function resolveTargetKey(candidates) {
    for (const c of candidates) {
      if (c && (contentStore.digests[c] || contentStore.posts[c])) return c;
    }
    return null;
  }
  function resolveAccountTargetKey(account) {
    return resolveTargetKey([account.key, (account.ticker || '').toLowerCase(), slugify(account.name), slugify(account.legal_name)]);
  }
  function resolvePersonaTargetKey(p) {
    return resolveTargetKey([p.key, slugify(p.name)]);
  }

  // ── Theme (shared localStorage key with the Account Explorer page) ──
  (function initTheme() {
    const btn = el('themeToggle');
    const icon = btn.querySelector('i');
    function setIcon(theme) { icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars'; }
    let saved = null;
    try { saved = localStorage.getItem('scraperTheme'); } catch (e) {}
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
      setIcon(saved);
    }
    btn.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      setIcon(next);
      try { localStorage.setItem('scraperTheme', next); } catch (e) {}
    });
  })();

  // ── Data loading & Dynamic URL Endpoint Tracking ────────────
  function syncUrlState() {
    if (activeView === 'allJobs') {
      if (window.location.search !== '?view=jobs') {
        history.replaceState({ view: 'allJobs' }, '', `${window.location.pathname}?view=jobs`);
      }
      return;
    }
    if (!activeAccountId) {
      if (window.location.search) history.replaceState(null, '', window.location.pathname);
      return;
    }
    const params = new URLSearchParams();
    params.set('account', activeAccountId);
    if (activeLobId) params.set('lob', activeLobId);
    if (activeSalesTab) params.set('tab', activeSalesTab);
    const newQuery = `${window.location.pathname}?${params.toString()}`;
    if (window.location.search !== `?${params.toString()}`) {
      history.replaceState({ accountId: activeAccountId, lobId: activeLobId, tab: activeSalesTab }, '', newQuery);
    }
  }

  async function loadAccounts() {
    try {
      // Deep link: /?view=jobs opens the All Job Postings browser directly on load.
      const wantsJobsView = window.location.search === '?view=jobs';
      // Any other query string (stale/unsupported) resets to a clean root URL on hard-refresh.
      if (window.location.search && !wantsJobsView) {
        history.replaceState(null, '', window.location.pathname);
      }

      const [acctRes, contentRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/content').catch(() => null)
      ]);
      if (!acctRes.ok) throw new Error('Failed to load accounts');
      const data = await acctRes.json();
      accounts = data.accounts || [];

      if (contentRes && contentRes.ok) {
        contentStore = await contentRes.json();
      }

      renderTopbarTicker();
      renderNavTree();
      if (wantsJobsView) {
        await openAllJobsPage();
      } else {
        renderDigest();
      }
    } catch (err) {
      console.error(err);
      navTree.innerHTML = '<div class="nav-empty">Error loading accounts. Ensure the API is running.</div>';
      dashEmpty.classList.add('digest-mode');
      dashEmpty.innerHTML = '<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-block-text">Could not load account data. Ensure the API server is running.</div></div>';
    }
  }

  function timeAgo(isoDate) {
    if (!isoDate) return null;
    const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 14) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  }

  function renderDigest() {
    dashEmpty.classList.add('digest-mode');

    if (!accounts.length) {
      dashEmpty.innerHTML = `
        <div class="dash-empty-icon"><i class="bi bi-building"></i></div>
        <p class="dash-empty-title">No accounts yet</p>
        <p class="dash-empty-sub">Run the pipeline to populate your first account, then select it from the left panel.</p>`;
      dashEmpty.classList.remove('digest-mode');
      return;
    }

    const cSuite = accounts.reduce((s, a) => s + (a.c_suite_count || 0), 0);
    const vp = accounts.reduce((s, a) => s + (a.vp_count || 0), 0);
    const director = accounts.reduce((s, a) => s + (a.director_count || 0), 0);
    const manager = accounts.reduce((s, a) => s + (a.manager_count || 0), 0);
    const industries = new Set();
    accounts.forEach(a => (a.industries || []).forEach(i => industries.add(i)));
    const scoredCount = accounts.filter(a => a.heat_score != null).length;

    const recentlyUpdated = [...accounts]
      .filter(a => a.extracted_at)
      .sort((a, b) => new Date(b.extracted_at) - new Date(a.extracted_at))
      .slice(0, 6);
    const topByContacts = [...accounts]
      .sort((a, b) => (b.total_contacts_captured || 0) - (a.total_contacts_captured || 0))
      .slice(0, 6);

    const realDigestCount = Object.values(contentStore.digests || {}).filter(d => !isDryRunDigest(d)).length;
    const totalPosts = Object.values(contentStore.posts || {}).reduce((s, arr) => s + arr.length, 0);

    const visibleCount = DIGEST_SECTIONS.filter(s => digestSectionVisibility[s.id] !== false).length;

    const showStepGuide = digestSectionVisibility.step_guide !== false;
    const showRecent = digestSectionVisibility.recently_updated !== false;
    const showMapped = digestSectionVisibility.most_mapped !== false;
    const showSocial = digestSectionVisibility.social_digest !== false;
    const showAlerts = digestSectionVisibility.sales_alerts !== false;
    const showDomain = digestSectionVisibility.domain_expansion !== false;
    const showJobs = digestSectionVisibility.linkedin_jobs !== false;

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
              ${recentlyUpdated.length ? recentlyUpdated.map(a => `
                <button type="button" class="digest-list-row clickable" data-jump-account="${a.id}" title="Click to open ${esc(a.name)}">
                  <span class="digest-list-name"><i class="bi bi-building"></i> ${esc(a.name)}</span>
                  <span class="digest-list-meta">${esc(timeAgo(a.extracted_at))} <i class="bi bi-chevron-right"></i></span>
                </button>`).join('') : '<div class="empty-block" style="padding:10px 0;"><div class="empty-block-text">No extraction timestamps recorded yet.</div></div>'}
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
              ${topByContacts.length ? topByContacts.map(a => `
                <button type="button" class="digest-list-row clickable" data-jump-account="${a.id}" title="Click to open ${esc(a.name)}">
                  <span class="digest-list-name"><i class="bi bi-building"></i> ${esc(a.name)}</span>
                  <span class="digest-list-meta">${a.total_contacts_captured || 0} contacts <i class="bi bi-chevron-right"></i></span>
                </button>`).join('') : '<div class="empty-block" style="padding:10px 0;"><div class="empty-block-text">No contacts mapped yet.</div></div>'}
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
          ${renderContentDigestSummary()}
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
              ${renderGlobalSalesAlerts()}
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
              ${renderGlobalDomainExpansion()}
            </div>
          ` : ''}
        </div>
      `;
    }

    let jobsHtml = '';
    if (showJobs) {
      jobsHtml = `
        <div class="panel">
          <div class="panel-title">
            <span><i class="bi bi-linkedin"></i> Recent LinkedIn Job Postings</span>
            <div class="panel-title-tools">
              <span class="context-badge live"><i class="bi bi-broadcast"></i> Across All Accounts</span>
              <button type="button" class="panel-hide-btn" data-hide-section="linkedin_jobs" title="Hide this section from dashboard"><i class="bi bi-x-lg"></i></button>
            </div>
          </div>
          <p class="section-desc">Newest scraped job postings across every tracked account — a hiring-activity signal worth flagging on calls.</p>
          ${renderGlobalRecentJobs()}
          <button type="button" class="alert-view-account" id="viewAllJobsBtn" style="margin-top:12px;"><i class="bi bi-grid-3x3-gap"></i> View All Job Postings</button>
        </div>
      `;
    }

    const noSectionsVisible = visibleCount === 0;

    dashEmpty.innerHTML = `
      <div class="digest-header">
        <div class="digest-header-top">
          <div class="digest-header-main">
            <h2 class="digest-title"><i class="bi bi-bar-chart-line-fill"></i> Global Accounts Dashboard</h2>
            <p class="digest-sub">Live intelligence workspace tracking <strong>${accounts.length} enterprise account${accounts.length !== 1 ? 's' : ''}</strong>. Continuously aggregates signals from executive social feeds, SEC filings, organizational hierarchies, and StradIT service-fit opportunities.</p>
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
                    const isChecked = digestSectionVisibility[s.id] !== false;
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

      <!-- Quick Workflow Steps -->
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

      ${jobsHtml}

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
  }

  function renderGlobalDomainExpansion() {
    const rows = [];
    accounts.forEach(a => {
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

  function renderContentDigestSummary() {
    const digests = contentStore.digests || {};
    const posts = contentStore.posts || {};
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
    accounts.forEach(a => {
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
    accounts.forEach(a => {
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

  function dedupePersonas(list) {
    const seen = new Set();
    const out = [];
    list.forEach(p => {
      const k = p.id != null ? p.id : (p.key || p.name);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(p);
    });
    return out;
  }

  function getPersonasFor(account, lob) {
    if (lob) return lob.personas || [];
    return dedupePersonas((account.lobs || []).flatMap(l => l.personas || []));
  }

  function getTechFor(account, lob) {
    let base;
    if (lob) base = lob.technologies || [];
    else {
      const set = new Set();
      (account.lobs || []).forEach(l => (l.technologies || []).forEach(t => set.add(t)));
      base = [...set];
    }
    const extra = extraTech[account.id] || [];
    return [...new Set([...base, ...extra])];
  }

  function renderTopbarTicker() {
    if (!topbarTicker) return;
    const totalAccounts = accounts.length;
    const totalContacts = accounts.reduce((s, a) => s + (a.total_contacts_captured || (a.personas || []).length || 0), 0);
    let totalSignals = 0;
    accounts.forEach(a => {
      totalSignals += computeSignals(a, null).length;
    });

    topbarTicker.innerHTML = `
      <div class="topbar-ticker-pill" title="Total enterprise accounts monitored"><i class="bi bi-buildings"></i> <strong>${totalAccounts}</strong> Accounts</div>
      <div class="topbar-ticker-pill" title="Total executive contacts & decision makers mapped"><i class="bi bi-people-fill"></i> <strong>${totalContacts}</strong> Contacts</div>
      <div class="topbar-ticker-pill" title="Active signals captured from SEC filings, web & social discourse"><i class="bi bi-lightning-charge-fill"></i> <strong>${totalSignals}</strong> Signals</div>
    `;
  }

  // ── Left: Navigator tree ─────────────────────────────────────
  function renderNavTree() {
    const q = (navSearch.value || '').trim().toLowerCase();
    if (navSearchClear) navSearchClear.classList.toggle('d-none', !q);

    if (filterCountAll) filterCountAll.textContent = accounts.length;
    if (navDigestBtn) navDigestBtn.classList.toggle('active', activeAccountId === null);

    let filtered = accounts.filter(a => {
      // Search matching
      if (q) {
        const text = `${a.name || ''} ${a.ticker || ''} ${a.legal_name || ''} ${(a.industries || []).join(' ')}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      // Quick filter tabs
      if (navFilter === 'high_score') {
        return (a.heat_score || 0) >= 70;
      }
      if (navFilter === 'signal_ready') {
        const sigs = computeSignals(a, null);
        const entries = getAccountContentEntries(a);
        const matches = matchOfferings(entries);
        return sigs.length > 0 || matches.length > 0;
      }
      if (navFilter === 'deep_org') {
        const contacts = a.total_contacts_captured || (a.personas || []).length || 0;
        return contacts >= 10;
      }
      if (navFilter === 'multi_lob') {
        return (a.lobs || []).length > 1;
      }
      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      if (navSort === 'score') return (b.heat_score || 0) - (a.heat_score || 0);
      if (navSort === 'name') return (a.name || '').localeCompare(b.name || '');
      if (navSort === 'contacts') {
        const cA = a.total_contacts_captured || (a.personas || []).length || 0;
        const cB = b.total_contacts_captured || (b.personas || []).length || 0;
        return cB - cA;
      }
      if (navSort === 'recent') {
        return new Date(b.extracted_at || 0) - new Date(a.extracted_at || 0);
      }
      return 0;
    });

    if (navAccountCount) {
      navAccountCount.textContent = `Accounts (${filtered.length})`;
    }

    if (!filtered.length) {
      navTree.innerHTML = '<div class="nav-empty"><i class="bi bi-search" style="font-size:1.4rem;"></i>No accounts match the current filter or search.</div>';
      return;
    }

    navTree.innerHTML = filtered.map(a => {
      const isOpen = expandedAccountIds.has(a.id);
      const isActive = activeAccountId === a.id && !activeLobId;
      const lobs = a.lobs || [];
      const score = a.heat_score;
      const scoreClass = score >= 70 ? 'high' : (score >= 40 ? 'mid' : 'none');
      const scoreLabel = score != null ? `${score} SCORE` : '— SCORE';
      const contactsCount = a.total_contacts_captured || (a.personas || []).length || 0;
      const signalsCount = computeSignals(a, null).length;
      const subtitle = [a.ticker ? `Ticker: ${a.ticker}` : '', (a.industries || [])[0] || ''].filter(Boolean).join(' · ') || (a.location || 'Enterprise');

      const lobsHtml = isOpen ? `
        <div class="nav-lobs">
          ${lobs.map(l => {
            const isLobActive = activeAccountId === a.id && activeLobId === l.id;
            const lobContacts = (l.personas || []).length;
            return `
              <button type="button" class="nav-lob-card ${isLobActive ? 'active' : ''}" data-acct="${a.id}" data-lob="${l.id}" title="View ${esc(l.name)} division">
                <span class="nav-lob-title"><i class="bi bi-folder2"></i> ${esc(l.name)}</span>
                ${lobContacts ? `<span class="nav-lob-badge">${lobContacts}</span>` : ''}
              </button>
              ${(l.subLobs || []).length ? `<div class="nav-sublobs">${(l.subLobs || []).map(s => `<div class="nav-sublob-row">${esc(s.name)}</div>`).join('')}</div>` : ''}
            `;
          }).join('') || '<div class="nav-sublob-row">No lines of business</div>'}
        </div>` : '';

      return `
        <div class="nav-account">
          <div class="nav-account-card ${isActive ? 'active' : ''}" data-acct="${a.id}">
            <div class="nav-account-top">
              <span class="nav-account-avatar">${esc(initials(a.name))}</span>
              <span class="nav-account-name" title="${esc(a.name)}">${esc(a.name)}</span>
              <span class="nav-score-badge ${scoreClass}">${esc(scoreLabel)}</span>
              ${lobs.length ? `
                <button type="button" class="nav-tree-toggle ${isOpen ? 'open' : ''}" data-toggle-acct="${a.id}" title="Toggle divisions">
                  <i class="bi bi-chevron-right"></i>
                </button>
              ` : ''}
            </div>

            <div class="nav-account-sub">${esc(subtitle)}</div>

            <div class="nav-account-tags">
              ${signalsCount ? `<span class="nav-micro-tag"><i class="bi bi-lightning-charge-fill text-warning"></i> ${signalsCount}</span>` : ''}
              ${contactsCount ? `<span class="nav-micro-tag"><i class="bi bi-people-fill"></i> ${contactsCount} contacts</span>` : ''}
              ${lobs.length ? `<span class="nav-micro-tag"><i class="bi bi-diagram-2"></i> ${lobs.length} LOB${lobs.length !== 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
          ${lobsHtml}
        </div>`;
    }).join('');
  }

  // ── Left Column Event Listeners ───────────────────────────────
  if (navSearch) {
    navSearch.addEventListener('input', renderNavTree);
  }
  if (navSearchClear) {
    navSearchClear.addEventListener('click', function () {
      navSearch.value = '';
      navSearch.focus();
      renderNavTree();
    });
  }

  if (navCollapseBtn && dashNav) {
    navCollapseBtn.addEventListener('click', function () {
      const isCollapsed = dashNav.classList.toggle('is-collapsed');
      if (navCollapseIcon) {
        navCollapseIcon.className = isCollapsed ? 'bi bi-layout-sidebar' : 'bi bi-layout-sidebar-reverse';
      }
      navCollapseBtn.setAttribute('title', isCollapsed ? 'Expand navigator' : 'Collapse navigator');
    });
  }

  if (navFilters) {
    navFilters.addEventListener('click', function (e) {
      const pill = e.target.closest('.nav-filter-pill');
      if (!pill) return;
      navFilters.querySelectorAll('.nav-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      navFilter = pill.dataset.filter || 'all';
      renderNavTree();
    });
  }

  if (navSortSelect) {
    navSortSelect.addEventListener('change', function () {
      navSort = navSortSelect.value || 'score';
      renderNavTree();
    });
  }

  if (navToggleAllTree) {
    navToggleAllTree.addEventListener('click', function () {
      if (expandedAccountIds.size > 0) {
        expandedAccountIds.clear();
      } else {
        accounts.forEach(a => { if ((a.lobs || []).length) expandedAccountIds.add(a.id); });
      }
      renderNavTree();
    });
  }

  if (navDigestBtn) {
    navDigestBtn.addEventListener('click', function () {
      activeView = null;
      activeAccountId = null;
      activeLobId = null;
      renderNavTree();
      renderSelection();
    });
  }

  navTree.addEventListener('click', function (e) {
    const toggleBtn = e.target.closest('[data-toggle-acct]');
    if (toggleBtn) {
      e.stopPropagation();
      const id = Number(toggleBtn.dataset.toggleAcct);
      if (expandedAccountIds.has(id)) expandedAccountIds.delete(id);
      else expandedAccountIds.add(id);
      renderNavTree();
      return;
    }

    const lobBtn = e.target.closest('.nav-lob-card');
    if (lobBtn) {
      activeView = null;
      activeAccountId = Number(lobBtn.dataset.acct);
      activeLobId = Number(lobBtn.dataset.lob);
      expandedAccountIds.add(activeAccountId);
      renderNavTree();
      renderSelection();
      return;
    }

    const acctCard = e.target.closest('.nav-account-card');
    if (acctCard) {
      const id = Number(acctCard.dataset.acct);
      expandedAccountIds.add(id);
      activeView = null;
      activeAccountId = id;
      activeLobId = null;
      renderNavTree();
      renderSelection();
    }
  });

  function jumpToAccount(id) {
    expandedAccountIds.add(id);
    activeView = null;
    activeAccountId = id;
    activeLobId = null;
    renderNavTree();
    renderSelection();
  }
  dashEmpty.addEventListener('click', function (e) {
    const viewAllJobsBtn = e.target.closest('#viewAllJobsBtn');
    if (viewAllJobsBtn) {
      openAllJobsPage();
      return;
    }

    const jumpBtn = e.target.closest('[data-jump-account]');
    if (jumpBtn) {
      jumpToAccount(Number(jumpBtn.dataset.jumpAccount));
      return;
    }

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
        digestSectionVisibility[sectionId] = false;
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
      DIGEST_SECTIONS.forEach(s => { digestSectionVisibility[s.id] = true; });
      saveDigestSectionVisibility();
      renderDigest();
      showToast('All dashboard sections enabled.');
      return;
    }

    const resetBtn = e.target.closest('#digestResetBtn');
    if (resetBtn) {
      e.stopPropagation();
      DIGEST_SECTIONS.forEach(s => { digestSectionVisibility[s.id] = true; });
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
        digestSectionVisibility[sectionId] = cb.checked;
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

  // ── Center + Right: render selection ──────────────────────────
  function renderSelection() {
    closeContactDrawer();

    if (activeView === 'allJobs') {
      if (dashBody) dashBody.classList.add('no-account');
      if (dashPeople) { dashPeople.classList.add('d-none'); dashPeople.innerHTML = ''; }
      dashEmpty.classList.add('d-none');
      dashContent.classList.remove('d-none');
      dashContent.innerHTML = renderAllJobsPage();
      syncUrlState();
      return;
    }

    const account = accounts.find(a => a.id === activeAccountId);
    if (!account) {
      if (dashBody) dashBody.classList.add('no-account');
      if (dashPeople) dashPeople.classList.add('d-none');
      dashEmpty.classList.remove('d-none');
      dashContent.classList.add('d-none');
      if (dashPeople) dashPeople.innerHTML = '';
      renderDigest();
      syncUrlState();
      return;
    }
    const lob = activeLobId ? (account.lobs || []).find(l => l.id === activeLobId) : null;

    if (dashBody) dashBody.classList.remove('no-account');
    if (dashPeople) dashPeople.classList.remove('d-none');
    dashEmpty.classList.add('d-none');
    dashContent.classList.remove('d-none');
    dashContent.innerHTML = renderCenter(account, lob);
    dashPeople.innerHTML = renderPeople(account, lob);
    syncUrlState();
    if (activeSalesTab === 'alerts') syncOpportunitySignals(account);
    if (activeSalesTab === 'weekly') syncWeeklyUpdate(account);
  }

  // ── Quick Outreach Arsenal Copy Helpers ────────────────────────
  function getTopIcebreakerText(account) {
    const personas = dedupePersonas(account.personas || []);
    const p = personas.find(p => p.personalized_icebreaker);
    if (p && p.personalized_icebreaker) return p.personalized_icebreaker;
    return `Congratulations on ${account.name}'s ongoing market initiatives and technology investments.`;
  }

  function getColdEmailPitchText(account, matches) {
    const topMatch = matches && matches.length ? matches[0] : null;
    const offeringName = topMatch ? topMatch.label : 'Enterprise Digital Transformation';
    const pitch = topMatch ? topMatch.pitch : 'scale high-impact engineering workflows and decision intelligence.';
    return `Hi [First Name],\n\nI've been following ${account.name}'s strategic initiatives and noticed your focus in ${offeringName.toLowerCase()}.\n\nAt StradIT, we specialize in ${pitch}\n\nWould you be open to a brief 10-minute introductory conversation next Tuesday to share benchmarks from similar enterprise leaders?\n\nBest regards,\n[Your Name]`;
  }

  function getAccountCheatSheetText(account, lob) {
    const personas = dedupePersonas(account.personas || []);
    const tech = getTechFor(account, lob);
    return `=== SALES BATTLECARD: ${account.name} ===\n` +
      `Industry: ${(account.industries || []).join(', ') || 'Enterprise'}\n` +
      `Revenue: ${account.revenue || 'N/A'} | Location: ${account.location || 'N/A'}\n` +
      `Headcount: ${account.employee_count_range || 'N/A'} | Ticker: ${account.ticker || 'Private'}\n\n` +
      `Top Tech: ${tech.slice(0, 8).join(', ') || 'N/A'}\n\n` +
      `Key Buying Committee:\n` +
      personas.slice(0, 6).map(p => `• ${p.name} — ${p.title || 'Executive'} [${p.tier || 'Leader'}]${p.email ? ` (${p.email})` : ''}`).join('\n');
  }

  // ── Render Tab 1: Executive Briefing ──────────────────────────
  function renderExecutiveBriefingTab(account, lob, signals, matches) {
    const industries = (account.industries || []).slice(0, 6);
    const tech = getTechFor(account, lob);

    return `
      <!-- Top Strategic Signals Callout -->
      <div class="panel" style="border-left: 3px solid var(--brand);">
        <div class="panel-title">
          <span><i class="bi bi-stars"></i> Top Strategic Triggers &amp; Catalysts</span>
          <span class="context-badge live">${signals.length + matches.length} active triggers</span>
        </div>
        <p class="section-desc">Key high-priority catalysts detected from filings, social discourse, and technology footprints.</p>
        
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:4px;">
          ${matches.length ? `
            <div class="signal-chip" style="background:var(--brand-soft); border-color:rgba(0,97,255,.2); color:var(--brand);">
              <i class="bi bi-lightning-charge-fill"></i>
              <span><strong>${matches[0].label} Opportunity:</strong> ${esc(matches[0].pitch)}</span>
            </div>` : ''}
          ${signals.slice(0, 2).map((s, i) => `
            <button type="button" class="signal-chip ${s.detail ? 'clickable' : ''}" ${s.detail ? `data-signal-idx="${i}" title="Click to view detailed breakdown"` : ''}>
              <span class="signal-icon"><i class="bi ${s.icon}"></i></span>
              <span class="signal-text">${esc(s.text)}</span>
              ${s.detail ? '<span class="signal-badge-btn"><span>View Details</span> <i class="bi bi-chevron-right"></i></span>' : ''}
            </button>`).join('')}
        </div>
      </div>

      <!-- Firmographics & Scale -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-buildings"></i> Firmographics &amp; Scale</span>
          <span class="context-badge live"><i class="bi bi-check-circle-fill"></i> Verified Data</span>
        </div>
        <p class="section-desc">Core corporate attributes including founding year, workforce size, organizational structure, and operational industry sectors.</p>
        <div class="chip-row">
          ${account.founded_year ? `<span class="chip" title="Year company was founded"><i class="bi bi-calendar3"></i> Founded ${esc(account.founded_year)}</span>` : ''}
          ${account.employee_count_range ? `<span class="chip" title="Estimated global employee headcount"><i class="bi bi-people"></i> ${esc(account.employee_count_range)}</span>` : ''}
          ${account.company_type ? `<span class="chip" title="Corporate ownership structure"><i class="bi bi-building"></i> ${esc(account.company_type)}</span>` : ''}
          ${(account.lobs || []).length ? `<span class="chip" title="Distinct operational business units and divisions discovered"><i class="bi bi-folder2"></i> ${account.lobs.length} line${account.lobs.length !== 1 ? 's' : ''} of business</span>` : ''}
          ${industries.map(i => `<span class="chip" title="Primary industry taxonomy sector"><i class="bi bi-tag"></i> ${esc(i)}</span>`).join('')}
          ${(!account.founded_year && !account.employee_count_range && !industries.length) ? '<span class="chip">No firmographic data captured yet</span>' : ''}
        </div>
      </div>

      <!-- Detected Tech Stack -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-cpu-fill"></i> Detected Technology Stack</span>
          <span class="context-badge ai">${tech.length} identified</span>
        </div>
        <p class="section-desc">Cloud infrastructure, data tooling, enterprise frameworks, and developer platforms active in this account.</p>
        <div class="chip-row">
          ${tech.length ? tech.map(t => `<span class="chip" title="Active technology in stack"><i class="bi bi-cpu"></i> ${esc(t)}</span>`).join('') : '<span class="chip">No tech stack detected yet</span>'}
        </div>
      </div>

      <!-- Digital Footprint & Traffic Analytics -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-activity"></i> Digital Footprint &amp; Web Analytics</span>
          <span class="context-badge live"><i class="bi bi-broadcast"></i> Web Telemetry</span>
        </div>
        <p class="section-desc">Audience retention, web ranking momentum, and visitor volume.</p>
        ${renderEngagementPanel(account)}
      </div>

      <!-- Multi-Source Signals Summary -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-radar"></i> Multi-Source Account Signals</span>
          <span class="context-badge live">${signals.length} signals</span>
        </div>
        <p class="section-desc">Aggregated from LinkedIn headcount, SEC 10-K filings, GLEIF legal entities, and funding records. Click to explore details.</p>
        ${signals.length ? signals.map((s, i) => `
          <button type="button" class="signal-chip ${s.detail ? 'clickable' : ''}" ${s.detail ? `data-signal-idx="${i}" title="Click to view detailed breakdown"` : ''}>
            <span class="signal-icon"><i class="bi ${s.icon}"></i></span>
            <span class="signal-text">${esc(s.text)}</span>
            ${s.detail ? '<span class="signal-badge-btn"><span>Explore Details</span> <i class="bi bi-chevron-right"></i></span>' : ''}
          </button>`).join('')
          : `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-search"></i></div><div class="empty-block-text">No signals detected yet for this ${lob ? 'line of business' : 'account'}.</div></div>`}
      </div>
    `;
  }

  // ── Render Tab 2: Buying Committee & Org Chart ─────────────────
  function renderBuyingCommitteeTab(account, lob) {
    return `
      <div class="info-banner">
        <i class="bi bi-diagram-3-fill"></i>
        <div>
          <strong>Verified Reporting Hierarchy:</strong> Direct reporting relationships and decision-making tiers for ${lob ? `<strong>${esc(lob.name)}</strong>` : 'the enterprise group'}. Click any executive node to open their complete AI Call-Prep Dossier.
        </div>
      </div>

      <!-- Full-Width Verified Hierarchy Panel -->
      <div class="panel" style="margin-bottom:0; min-height: 480px;">
        <div class="panel-title">
          <span><i class="bi bi-diagram-3"></i> Verified Hierarchy</span>
          <span class="context-badge live">${lob ? esc(lob.name) : 'Corporate Level'}</span>
        </div>
        <p class="section-desc">Interactive organizational reporting tree showing executive hierarchy, leadership tiers, and decision-making authority.</p>
        ${renderOrgChart(account, lob)}
      </div>
    `;
  }

  // ── Render Tab 3: Sales Alerts & Battlecards ───────────────────
  function renderSalesAlertsTab(account, lob, matches) {
    return `
      <!-- Panel 1: Direct Service Line Matches -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-lightning-charge-fill"></i> StradIT Service Line Fit &amp; Opportunities</span>
          <span class="context-badge ai"><i class="bi bi-stars"></i> ${matches.length} matches</span>
        </div>
        <p class="section-desc">Immediate opportunities discovered by cross-referencing StradIT core offerings with real citations in public filings and executive statements.</p>
        ${renderSalesAlerts(account)}
      </div>

      <!-- Panel 2: Growth Whitespace Panel -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-compass"></i> Unserved Content Themes &amp; Growth Whitespace</span>
          <span class="context-badge pending"><i class="bi bi-signpost-split"></i> Whitespace</span>
        </div>
        <p class="section-desc">Recurring themes in this account's discourse that don't match existing service lines, with a suggested build for each — potential areas for custom solution engineering. Themes seen before persist here as history even if they stop recurring.</p>
        <div id="growthOpportunitiesBody">${renderGrowthOpportunities(account, (opportunityHistory[account.id] || {}).growth_theme)}</div>
      </div>

      <!-- Panel 3: Emerging Expansion Domains & Custom Engineering (New) -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-rocket-takeoff-fill"></i> Emerging Domain Expansion &amp; Custom Integration</span>
          <span class="context-badge live"><i class="bi bi-layers-fill"></i> High-Demand Scope</span>
        </div>
        <p class="section-desc">Trending enterprise initiatives and adjacent technology domains heavily demanded by <strong>${esc(account.name)}</strong> where StradIT can engineer custom integrated solutions. Previously suggested domains stay listed as history.</p>
        <div id="domainExpansionBody">${renderDomainExpansionOpportunities(account, (opportunityHistory[account.id] || {}).domain_expansion)}</div>
      </div>
    `;
  }

  // ── Render Tab 4: Financials & SEC Intelligence ────────────────
  function renderFinancialsTab(account, lob) {
    return `
      ${lob ? `
        <!-- Financial Intelligence (LOB-specific) -->
        <div class="panel">
          <div class="panel-title">
            <span><i class="bi bi-cash-stack"></i> Line of Business Financials</span>
            <span class="context-badge ai">${esc(lob.name)}</span>
          </div>
          <p class="section-desc">Extracted segment revenues, operating performance, and financial disclosures for <strong>${esc(lob.name)}</strong>.</p>
          ${renderFinancialSnippets(lob)}
        </div>` : ''}

      <!-- SEC 10-K & Public Market Intelligence -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-file-earmark-text"></i> SEC 10-K Filings &amp; Regulatory Disclosures</span>
          <span class="context-badge live"><i class="bi bi-bank"></i> Edgar Registry</span>
        </div>
        <p class="section-desc">Annual report disclosures, risk factors, MD&amp;A commentary, and organizational structures extracted from SEC Edgar filings.</p>
        
        <div style="margin-bottom:14px;">
          ${account.sec_cik ? `
            <div class="stat-row"><span class="stat-label">SEC CIK Identifier</span><span class="stat-value">${esc(account.sec_cik)}</span></div>
            <button type="button" class="action-btn" id="fetchSecBtn" data-cik="${esc(account.sec_cik)}" style="margin-top:12px;width:auto;padding:8px 16px;">
              <i class="bi bi-cloud-arrow-down"></i> Fetch &amp; Index Full 10-K Filing
            </button>
            <div id="secFetchResult"></div>
          ` : `
            <div class="empty-block">
              <div class="empty-block-icon"><i class="bi bi-file-earmark-x"></i></div>
              <div class="empty-block-text">No SEC CIK code recorded for this entity. Typically available for publicly listed US enterprises.</div>
            </div>
          `}
        </div>
      </div>

      <!-- Funding & Capital Structure -->
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-cash-coin"></i> Capitalization &amp; Funding History</span>
          <span class="context-badge live">Crunchbase / Pitchbook</span>
        </div>
        <p class="section-desc">Historical funding rounds, total capital raised, lead investors, and IPO listing milestone records.</p>
        <div class="metrics-grid">
          <div class="metric-tile">
            <div class="metric-value font-semibold">${account.total_funding_amount_usd ? `$${Number(account.total_funding_amount_usd).toLocaleString()}` : '—'}</div>
            <div class="metric-label">Total Capital Raised</div>
          </div>
          <div class="metric-tile">
            <div class="metric-value">${esc(account.last_funding_type || '—')}</div>
            <div class="metric-label">Last Round Type</div>
          </div>
          <div class="metric-tile">
            <div class="metric-value">${esc(account.num_funding_rounds ?? '—')}</div>
            <div class="metric-label">Total Rounds</div>
          </div>
          <div class="metric-tile">
            <div class="metric-value">${esc(account.ipo_status || (account.ticker ? 'Public' : 'Private'))}</div>
            <div class="metric-label">Listing Status</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render Tab 5: Live Social & Content Listening ──────────────
  function renderSocialTab(account, lob) {
    return `
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-chat-square-text"></i> Social &amp; Content Intelligence</span>
          <span class="context-badge ai"><i class="bi bi-robot"></i> LLM Synthesized</span>
        </div>
        <p class="section-desc">Synthesized summaries, executive discussion themes, and storylines captured across Twitter/X, LinkedIn, Reddit, News, and Press releases.</p>
        ${renderContentPanel(account)}
      </div>
    `;
  }

  // ── Render Tab: Sales Weekly Update Mail ───────────────────────
  function getCurrentWeeklyEmail(account) {
    const key = resolveAccountTargetKey(account);
    const d = key ? contentStore.digests[key] : null;
    if (!d || isDryRunDigest(d) || !d.digest || !d.digest.email) return null;
    return { ...d.digest.email, generated_at: d.generated_at, target_key: key };
  }

  function formatWeekOf(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function priorityPill(priority) {
    if (!priority) return '';
    const cls = /high/i.test(priority) ? 'pill-danger' : /medium/i.test(priority) ? 'pill-warning' : 'pill-success';
    return `<span class="pill ${cls}">${esc(priority)} priority</span>`;
  }

  function renderWeeklyEmailCard(email, opts) {
    opts = opts || {};
    if (!email) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-envelope"></i></div>
        <div class="empty-block-text">No weekly sales update email generated yet for this account.</div>
      </div>`;
    }
    return `
      <div class="weekly-email-card">
        <div class="weekly-email-header">
          <div>
            <div class="weekly-email-week">${opts.current ? 'This week' : esc(formatWeekOf(email.week_of || email.generated_at))}${email.generated_at ? ` <span class="weekly-email-date">· generated ${esc(formatWeekOf(email.generated_at))}</span>` : ''}</div>
            <div class="weekly-email-subject">${esc(email.subject || '(No subject)')}</div>
          </div>
          ${priorityPill(email.priority)}
        </div>
        <div class="weekly-email-body">${(email.body || '').split('\n').filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}</div>
        ${email.confidence ? `<div class="weekly-email-meta"><i class="bi bi-shield-check"></i> Confidence: ${esc(email.confidence)}</div>` : ''}
        ${(email.data_gaps || []).length ? `<details class="weekly-email-details"><summary>Data gaps (${email.data_gaps.length})</summary>${email.data_gaps.map(g => `<p>${esc(g)}</p>`).join('')}</details>` : ''}
        ${(email.do_not_say || []).length ? `<details class="weekly-email-details"><summary>Do not say (${email.do_not_say.length})</summary>${email.do_not_say.map(g => `<p>${esc(g)}</p>`).join('')}</details>` : ''}
      </div>`;
  }

  function renderWeeklyUpdateHistoryList(pastOnly) {
    if (!pastOnly.length) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-archive"></i></div>
        <div class="empty-block-text">No past weekly updates archived yet — check back after next week's pipeline run.</div>
      </div>`;
    }
    return pastOnly.map(h => `
      <details class="weekly-email-archive-item">
        <summary>
          <span class="weekly-email-week">${esc(formatWeekOf(h.week_of))}</span>
          <span class="weekly-email-subject-sm">${esc(h.subject || '(No subject)')}</span>
          ${priorityPill(h.priority)}
        </summary>
        ${renderWeeklyEmailCard(h)}
      </details>`).join('');
  }

  function renderWeeklyUpdateTab(account) {
    const current = getCurrentWeeklyEmail(account);
    const history = weeklyUpdateHistory[account.id] || [];
    const pastOnly = history.filter(h => h.generated_at !== (current ? current.generated_at : null));

    return `
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-envelope-paper-fill"></i> Sales Weekly Update Mail</span>
          <span class="context-badge ai"><i class="bi bi-stars"></i> LLM Generated</span>
        </div>
        <p class="section-desc">Auto-generated weekly sales briefing email for this account, regenerated on every pipeline run.</p>
        <div id="weeklyUpdateCurrentBody">${renderWeeklyEmailCard(current, { current: true })}</div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-clock-history"></i> Past Weekly Updates</span>
          <span class="context-badge live">${pastOnly.length} archived</span>
        </div>
        <p class="section-desc">Previously generated weekly update emails, preserved here even after a newer version replaces the live one above.</p>
        <div id="weeklyUpdateHistoryBody">${renderWeeklyUpdateHistoryList(pastOnly)}</div>
      </div>
    `;
  }

  // Archives the current week's sales update email (if any) into permanent history, then
  // repaints the tab with the merged current + past-weeks view.
  async function syncWeeklyUpdate(account) {
    const email = getCurrentWeeklyEmail(account);
    if (!email || !email.generated_at) return;
    let data = null;
    try {
      const res = await fetch(`/api/accounts/${account.id}/weekly-updates/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_key: email.target_key,
          generated_at: email.generated_at,
          subject: email.subject, body: email.body,
          priority: email.priority, confidence: email.confidence,
          data_gaps: email.data_gaps || [], do_not_say: email.do_not_say || []
        })
      });
      if (res.ok) data = await res.json();
    } catch (err) {
      console.error('Weekly update sync failed', err);
      return;
    }
    if (!data) return;
    weeklyUpdateHistory[account.id] = data.updates;
    if (activeAccountId === account.id && activeSalesTab === 'weekly') {
      const currentBody = el('weeklyUpdateCurrentBody');
      const histBody = el('weeklyUpdateHistoryBody');
      const pastOnly = data.updates.filter(h => h.generated_at !== email.generated_at);
      if (currentBody) currentBody.innerHTML = renderWeeklyEmailCard(email, { current: true });
      if (histBody) histBody.innerHTML = renderWeeklyUpdateHistoryList(pastOnly);
      const badge = document.querySelector('#salesTabsNav [data-tab="weekly"] .tab-badge');
      if (badge) badge.textContent = data.updates.length;
    }
  }

  // ── Render Tab: LinkedIn Job Postings ──────────────────────────
  function getAccountJobs(account) {
    const key = resolveAccountTargetKey(account);
    return key ? (contentStore.jobs[key] || []) : [];
  }

  function formatJobSalary(salary) {
    if (!salary) return null;
    if (salary.text) return salary.text;
    const fmt = n => `$${Number(n).toLocaleString()}`;
    if (salary.min != null && salary.max != null) return `${fmt(salary.min)}–${fmt(salary.max)}`;
    if (salary.min != null) return fmt(salary.min);
    if (salary.max != null) return fmt(salary.max);
    return null;
  }

  function renderJobCard(job, opts) {
    opts = opts || {};
    const salaryText = formatJobSalary(job.salary);
    return `
      <div class="job-card">
        <div class="job-card-header">
          <div class="job-card-title-wrap">
            <div class="job-card-title">${esc(job.title || 'Untitled role')}</div>
            <div class="job-card-company"><i class="bi bi-building"></i> ${esc(job.company_name || opts.accountName || '')}${job.location ? ` · ${esc(job.location)}` : ''}</div>
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
          ${opts.showAccountLink ? `<button type="button" class="alert-view-account" data-jump-account="${opts.accountId}">Open ${esc(opts.accountName)} <i class="bi bi-arrow-right"></i></button>` : ''}
          ${job.job_url ? `<a href="${esc(job.job_url)}" target="_blank" rel="noopener" class="job-card-link"><i class="bi bi-box-arrow-up-right"></i> View posting</a>` : ''}
        </div>
      </div>`;
  }

  function renderAccountJobsTab(account) {
    const jobs = getAccountJobs(account);
    return `
      <div class="panel">
        <div class="panel-title">
          <span><i class="bi bi-linkedin"></i> Recent LinkedIn Job Postings</span>
          <span class="context-badge live">${jobs.length} open role${jobs.length !== 1 ? 's' : ''}</span>
        </div>
        <p class="section-desc">Job postings scraped from ${esc(account.name)}'s LinkedIn presence — a useful signal for hiring pushes, team growth, and tech-stack clues.</p>
        ${jobs.length ? jobs.map(j => renderJobCard(j)).join('') : `<div class="empty-block">
          <div class="empty-block-icon"><i class="bi bi-linkedin"></i></div>
          <div class="empty-block-text">No LinkedIn job postings captured yet for this account.</div>
        </div>`}
      </div>
    `;
  }

  function renderGlobalRecentJobs() {
    const rows = [];
    accounts.forEach(a => {
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
    return top.map(({ account, job }) => renderJobCard(job, { showAccountLink: true, accountId: account.id, accountName: account.name })).join('');
  }

  // ── Main Center Assembly with Tabs ─────────────────────────────
  function renderCenter(account, lob) {
    const signals = computeSignals(account, lob);
    currentSignals = signals;

    const entries = getAccountContentEntries(account);
    const matches = matchOfferings(entries);

    const personas = dedupePersonas(getPersonasFor(account, lob));
    const targetKey = resolveAccountTargetKey(account);
    const postCount = targetKey ? (contentStore.posts[targetKey] || []).length : 0;

    let tabContent = '';
    if (activeSalesTab === 'committee') {
      tabContent = renderBuyingCommitteeTab(account, lob);
    } else if (activeSalesTab === 'alerts') {
      tabContent = renderSalesAlertsTab(account, lob, matches);
    } else if (activeSalesTab === 'financials') {
      tabContent = renderFinancialsTab(account, lob);
    } else if (activeSalesTab === 'social') {
      tabContent = renderSocialTab(account, lob);
    } else if (activeSalesTab === 'weekly') {
      tabContent = renderWeeklyUpdateTab(account);
    } else if (activeSalesTab === 'jobs') {
      tabContent = renderAccountJobsTab(account);
    } else {
      tabContent = renderExecutiveBriefingTab(account, lob, signals, matches);
    }

    return `
      <!-- Account Overview Header Panel -->
      <div class="panel" style="margin-bottom:12px;">
        <div class="acct-header">
          <div class="acct-avatar-lg">${esc(initials(account.name))}</div>
          <div class="acct-header-body">
            <h2 class="acct-name">${esc(account.name)}${lob ? ' · ' + esc(lob.name) : ''}</h2>
            <div class="acct-pills">
              <span class="pill pill-brand" title="Public / Private stock ticker classification"><i class="bi bi-tag"></i> ${esc(account.ticker || 'Private')}</span>
              <span class="pill" title="Annual reported revenue"><i class="bi bi-currency-dollar"></i> ${esc(account.revenue || 'Revenue N/A')}</span>
              <span class="pill pill-success" title="Corporate headquarters location"><i class="bi bi-geo-alt"></i> ${esc(account.location || 'Location N/A')}</span>
              ${account.operating_status ? `<span class="pill" title="Current operational status"><i class="bi bi-activity"></i> ${esc(account.operating_status)}</span>` : ''}
            </div>
            <p class="acct-desc">${esc(lob ? (lob.desc || 'No description available.') : (account.desc || 'No description available.'))}</p>
          </div>
          ${renderScoreRing(account)}
        </div>
        ${renderTrendPill(account)}
      </div>

      <!-- 🎯 Workflow Navigation Tabs -->
      <div class="sales-tabs" id="salesTabsNav">
        <button type="button" class="tab-btn ${activeSalesTab === 'briefing' ? 'active' : ''}" data-tab="briefing" title="30-Second account snapshot & core triggers">
          <i class="bi bi-speedometer2"></i> Executive Briefing
        </button>
        <button type="button" class="tab-btn ${activeSalesTab === 'committee' ? 'active' : ''}" data-tab="committee" title="Visual hierarchy & stakeholder committee mapping">
          <i class="bi bi-people"></i> Buying Committee <span class="tab-badge">${personas.length}</span>
        </button>
        <button type="button" class="tab-btn ${activeSalesTab === 'alerts' ? 'active' : ''}" data-tab="alerts" title="StradIT service offering matches & sales battlecards">
          <i class="bi bi-lightning-charge"></i> Sales Alerts &amp; Angles <span class="tab-badge">${matches.length}</span>
        </button>
        <button type="button" class="tab-btn ${activeSalesTab === 'social' ? 'active' : ''}" data-tab="social" title="Live discourse, executive tweets, and social sentiment">
          <i class="bi bi-chat-square-text"></i> Social Listening <span class="tab-badge">${postCount}</span>
        </button>
        <button type="button" class="tab-btn ${activeSalesTab === 'weekly' ? 'active' : ''}" data-tab="weekly" title="Weekly sales update email, current and archived past weeks">
          <i class="bi bi-envelope-paper"></i> Weekly Update Mail <span class="tab-badge">${(weeklyUpdateHistory[account.id] || []).length}</span>
        </button>
        <button type="button" class="tab-btn ${activeSalesTab === 'jobs' ? 'active' : ''}" data-tab="jobs" title="Recent LinkedIn job postings for this account">
          <i class="bi bi-linkedin"></i> Job Postings <span class="tab-badge">${getAccountJobs(account).length}</span>
        </button>
      </div>

      <!-- Tab Content Area -->
      <div id="salesTabContentArea" class="fade-in">
        ${tabContent}
      </div>
    `;
  }

  function parseSnippetTable(text) {
    if (!text || text.indexOf('|') === -1) return null;
    const cells = text.split('|').map(c => c.trim()).filter(Boolean);
    for (const cols of [5, 4, 6, 3]) {
      if (cells.length >= cols * 2 && cells.length % cols === 0) {
        const rows = [];
        for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols));
        return rows;
      }
    }
    return null;
  }

  function renderFinancialSnippets(lob) {
    const snippets = lob.financial_snippets || [];
    if (!snippets.length) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-cash-stack"></i></div>
        <div class="empty-block-text">No financial snippets captured yet for this line of business.</div>
      </div>`;
    }
    return snippets.map(s => {
      const rows = parseSnippetTable(s);
      if (rows && rows.length > 1) {
        const [header, ...body] = rows;
        return `
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead><tr>${header.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
              <tbody>${body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>`;
      }
      return `<blockquote class="fin-snippet"><i class="bi bi-quote"></i> ${esc(s)}</blockquote>`;
    }).join('');
  }

  function renderOrgChart(account, lob) {
    if (lob) {
      const lobPersonas = dedupePersonas(lob.personas || []);
      const headName = lob.head || lob.operating_head;

      let rootNode = null;
      let reports = [];

      if (headName) {
        rootNode = lobPersonas.find(p => p.name === headName || p.full_name === headName) || {
          full_name: headName,
          job_title: 'Operating Head',
          seniority_tier: 'Division Head',
          decision_authority: 'primary'
        };
        reports = lobPersonas.filter(p => (p.name || p.full_name) !== headName);
      } else if (lobPersonas.length) {
        const sorted = [...lobPersonas].sort((a, b) => {
          const aTier = (a.tier || '').toLowerCase().includes('c') ? 0 : ((a.tier || '').toLowerCase().includes('vp') ? 1 : 2);
          const bTier = (b.tier || '').toLowerCase().includes('c') ? 0 : ((b.tier || '').toLowerCase().includes('vp') ? 1 : 2);
          if (aTier !== bTier) return aTier - bTier;
          return (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99);
        });
        rootNode = sorted[0];
        reports = sorted.slice(1);
      }

      if (!rootNode) {
        return `<div class="empty-block">
          <div class="empty-block-icon"><i class="bi bi-diagram-2"></i></div>
          <div class="empty-block-text">No verified reporting-line tree captured yet for <strong>${esc(lob.name)}</strong>.</div>
        </div>`;
      }

      function nodeCard(node, isRoot) {
        const name = node.full_name || node.name || 'Executive';
        const title = node.job_title || node.title || (isRoot ? 'Operating Head' : 'Stakeholder');
        const tags = [node.seniority_tier || node.tier, node.decision_authority ? `Decision: ${node.decision_authority}` : null].filter(Boolean);
        return `
          <button type="button" class="orgchart-node ${isRoot ? 'orgchart-root-node' : ''}" data-persona-name="${esc(name)}">
            <div class="orgchart-avatar">${esc(initials(name))}</div>
            <div class="orgchart-name">${esc(name)}</div>
            <div class="orgchart-title">${esc(title)}</div>
            ${tags.length ? `<div class="orgchart-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          </button>`;
      }

      return `
        <div class="orgchart">
          <div class="orgchart-root">${nodeCard(rootNode, true)}</div>
          ${reports.length ? `
            <div class="orgchart-connector"></div>
            <div class="orgchart-reports">${reports.map(r => nodeCard(r, false)).join('')}</div>
          ` : ''}
        </div>
      `;
    }

    // Corporate level (no LOB selected) — render full multi-tier enterprise tree
    const allPersonas = dedupePersonas(account.personas || []);
    const tree = account.organisational_hierarchy_tree || {};

    // 1. Root Node (CEO / President)
    const rootName = tree.full_name || (allPersonas.find(p => /chief executive|ceo|president/i.test(p.title || '')) || allPersonas[0] || {}).name;
    const rootPersona = allPersonas.find(p => p.name === rootName) || {
      full_name: rootName || 'Chief Executive Officer',
      job_title: tree.job_title || 'President & Chief Executive Officer',
      seniority_tier: 'C-Suite',
      decision_authority: 'final'
    };

    // 2. Level 2: C-Suite & Board Level Direct Reports
    const cSuiteReports = [];
    const directNames = new Set((tree.direct_reports || []).map(r => r.full_name));
    
    allPersonas.forEach(p => {
      if (p.name === rootName) return;
      const isC = (p.tier || '').toLowerCase().includes('c') || /director of board|board member|chairman|vice chair|lead consultant/i.test(p.title || '') || directNames.has(p.name);
      if (isC) {
        cSuiteReports.push(p);
      }
    });

    // 3. Level 3: All remaining VPs grouped by Functional Domain
    const renderedNames = new Set([rootName, ...cSuiteReports.map(p => p.name)]);
    const remainingVPs = allPersonas.filter(p => !renderedNames.has(p.name));

    const clusters = [
      {
        id: 'directors',
        title: 'Vice Presidents & Directors',
        icon: 'bi-award',
        filter: p => /director/i.test(p.title || '')
      },
      {
        id: 'dept_app',
        title: 'Department & Application Leadership',
        icon: 'bi-grid-1x2',
        filter: p => /department head|application|tax manager|team lead/i.test(p.title || '')
      },
      {
        id: 'scrum_proj',
        title: 'Engineering, Project & Scrum Leads',
        icon: 'bi-cpu',
        filter: p => /scrum|project lead|consultant/i.test(p.title || '')
      },
      {
        id: 'ops_lead',
        title: 'Operations & Enterprise Lead Managers',
        icon: 'bi-briefcase',
        filter: () => true // Catch-all for remaining VPs
      }
    ];

    const vpGroups = [];
    const assignedVpNames = new Set();

    clusters.forEach(c => {
      const matched = remainingVPs.filter(p => !assignedVpNames.has(p.name) && c.filter(p));
      matched.forEach(p => assignedVpNames.add(p.name));
      if (matched.length) {
        vpGroups.push({ ...c, people: matched });
      }
    });

    function nodeCard(node, isRoot) {
      const name = node.full_name || node.name || 'Executive';
      const title = node.job_title || node.title || (isRoot ? 'President & CEO' : 'Executive');
      const tags = [node.seniority_tier || node.tier, node.decision_authority ? `Decision: ${node.decision_authority}` : null].filter(Boolean);
      return `
        <button type="button" class="orgchart-node ${isRoot ? 'orgchart-root-node' : ''}" data-persona-name="${esc(name)}">
          <div class="orgchart-avatar">${esc(initials(name))}</div>
          <div class="orgchart-name">${esc(name)}</div>
          <div class="orgchart-title">${esc(title)}</div>
          ${tags.length ? `<div class="orgchart-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </button>`;
    }

    return `
      <div class="orgchart">
        <!-- Level 1: Group Chief Executive -->
        <div class="orgchart-root">${nodeCard(rootPersona, true)}</div>

        ${cSuiteReports.length ? `
          <div class="orgchart-connector"></div>
          <!-- Level 2: C-Suite & Executive Board -->
          <div class="orgchart-reports">${cSuiteReports.map(r => nodeCard(r, false)).join('')}</div>
        ` : ''}

        ${vpGroups.length ? `
          <div class="orgchart-connector" style="height:20px;"></div>
          <!-- Level 3: Functional VP & Divisional Branches -->
          ${vpGroups.map(g => `
            <div class="orgchart-tier-block">
              <div class="orgchart-tier-header">
                <span class="orgchart-tier-title"><i class="bi ${g.icon}"></i> ${esc(g.title)}</span>
                <span class="orgchart-tier-count">${g.people.length} mapped</span>
              </div>
              <div class="orgchart-tier-grid">
                ${g.people.map(p => nodeCard(p, false)).join('')}
              </div>
            </div>
          `).join('')}
        ` : ''}
      </div>
    `;
  }

  function renderScoreRing(account) {
    const score = account.heat_score;
    if (score == null) {
      return `<div class="score-ring" title="No opportunity score yet — heat_score wasn't populated for this account during ingestion">
        <div class="score-ring-value">—<br><span style="font-size:.55rem;font-weight:600;">SCORE</span></div>
      </div>`;
    }
    const pct = Math.max(0, Math.min(100, score));
    const deg = pct * 3.6;
    const color = pct >= 70 ? 'var(--success)' : (pct >= 40 ? 'var(--warning)' : 'var(--danger)');
    return `<div class="score-ring" style="background:conic-gradient(${color} ${deg}deg, var(--border-color) ${deg}deg 360deg);" title="Opportunity score from heat_score (0-100, captured during ingestion)">
      <div class="score-ring-value">${Math.round(pct)}<br><span style="font-size:.55rem;font-weight:600;">SCORE</span></div>
    </div>`;
  }

  function renderTrendPill(account) {
    if (account.trend_score_90d == null) return '';
    const t = account.trend_score_90d;
    const up = t >= 0;
    return `<div style="margin-top:10px;"><span class="pill ${up ? 'pill-success' : 'pill-danger'}"><i class="bi ${up ? 'bi-graph-up-arrow' : 'bi-graph-down-arrow'}"></i> 90-Day Trend: ${up ? '+' : ''}${t}</span></div>`;
  }

  function renderEngagementPanel(account) {
    const rows = [];
    if (account.trend_score_90d != null) {
      const t = account.trend_score_90d;
      const pct = Math.max(0, Math.min(100, (t + 100) / 2));
      rows.push({ label: '90-Day Trend Score', value: `${t > 0 ? '+' : ''}${t}`, pct, color: t >= 0 ? 'var(--success)' : 'var(--danger)' });
    }
    if (account.global_traffic_rank != null) {
      rows.push({ label: 'Global Traffic Rank', value: `#${Number(account.global_traffic_rank).toLocaleString()}` });
    }
    if (account.monthly_visits != null) {
      rows.push({ label: 'Monthly Visits', value: Number(account.monthly_visits).toLocaleString() });
    }
    if (account.bounce_rate != null) {
      rows.push({ label: 'Bounce Rate', value: `${account.bounce_rate}%`, pct: Math.max(0, Math.min(100, account.bounce_rate)) });
    }
    if (account.visit_duration != null) {
      rows.push({ label: 'Avg Visit Duration', value: `${account.visit_duration}s` });
    }
    if (account.page_views_per_visit != null) {
      rows.push({ label: 'Page Views / Visit', value: account.page_views_per_visit });
    }

    if (!rows.length) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-graph-down"></i></div>
        <div class="empty-block-text">No engagement trend data yet. This needs a web-analytics source wired into the pipeline.</div>
      </div>`;
    }

    return rows.map(r => `
      <div class="stat-row">
        <span class="stat-label">${esc(r.label)}</span>
        <span class="stat-value">${esc(r.value)}</span>
      </div>
      ${r.pct != null ? `<div class="progress-track"><div class="progress-fill" style="width:${r.pct}%;${r.color ? `background:${r.color};` : ''}"></div></div>` : ''}
    `).join('');
  }

  function computeSignals(account, lob) {
    const signals = [];
    const msi = account.multi_source_intelligence || {};

    if (msi.linkedin_metrics && msi.linkedin_metrics.follower_count) {
      const lm = msi.linkedin_metrics;
      signals.push({
        icon: 'bi-linkedin', text: `${Number(lm.follower_count).toLocaleString()} LinkedIn followers`,
        title: 'LinkedIn Snapshot',
        detail: `
          <div class="stat-row"><span class="stat-label">Followers</span><span class="stat-value">${Number(lm.follower_count).toLocaleString()}</span></div>
          ${lm.exact_employee_headcount ? `<div class="stat-row"><span class="stat-label">Employees (verified)</span><span class="stat-value">${Number(lm.exact_employee_headcount).toLocaleString()}</span></div>` : ''}
          ${(lm.specialties || []).length ? `<div class="dossier-label" style="margin-top:10px;">Specialties</div><div class="chip-row">${lm.specialties.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
          ${account.linkedin_url ? `<a class="social-link" style="margin-top:10px;" href="${esc(account.linkedin_url)}" target="_blank"><i class="bi bi-box-arrow-up-right"></i> Open LinkedIn profile</a>` : ''}
        `
      });
    }
    if (msi.linkedin_metrics && msi.linkedin_metrics.exact_employee_headcount) {
      signals.push({ icon: 'bi-people', text: `${Number(msi.linkedin_metrics.exact_employee_headcount).toLocaleString()} employees (verified via LinkedIn)` });
    }
    if (msi.sec_10k_chunks_meta && (msi.sec_10k_chunks_meta.sections_found || []).length) {
      const meta = msi.sec_10k_chunks_meta;
      signals.push({
        icon: 'bi-file-earmark-text', text: `Recent 10-K on file — ${meta.sections_found.join(', ')}`,
        title: 'SEC 10-K Filing',
        detail: `
          <div class="stat-row"><span class="stat-label">Accession number</span><span class="stat-value">${esc(meta.accession_number || '—')}</span></div>
          <div class="stat-row"><span class="stat-label">Sections available</span><span class="stat-value">${esc(meta.sections_found.join(', '))}</span></div>
          <div class="stat-row"><span class="stat-label">Chunks indexed</span><span class="stat-value">${esc(meta.total_chunks ?? '—')}</span></div>
          <button type="button" class="action-btn" id="fetchSecBtn" data-cik="${esc(account.sec_cik || '')}" style="margin-top:12px;">
            <i class="bi bi-cloud-arrow-down"></i> Fetch full filing text
          </button>
          <div id="secFetchResult"></div>
        `
      });
    }
    if (msi.gleif_intel && msi.gleif_intel.lei_code) {
      signals.push({
        icon: 'bi-patch-check', text: `LEI verified: ${msi.gleif_intel.lei_code} (${msi.gleif_intel.jurisdiction || 'jurisdiction unknown'})`,
        title: 'GLEIF Legal Entity Identity',
        detail: `
          <div class="stat-row"><span class="stat-label">Legal Entity Identifier</span><span class="stat-value">${esc(msi.gleif_intel.lei_code)}</span></div>
          <div class="stat-row"><span class="stat-label">Legal name</span><span class="stat-value">${esc(msi.gleif_intel.legal_name || account.legal_name || '—')}</span></div>
          <div class="stat-row"><span class="stat-label">Jurisdiction</span><span class="stat-value">${esc(msi.gleif_intel.jurisdiction || '—')}</span></div>
          <a class="social-link" style="margin-top:10px;" href="https://search.gleif.org/#/record/${encodeURIComponent(msi.gleif_intel.lei_code)}" target="_blank"><i class="bi bi-box-arrow-up-right"></i> View on GLEIF registry</a>
        `
      });
    }

    if (account.company_type === 'Public') {
      signals.push({
        icon: 'bi-graph-up-arrow', text: `Publicly traded — ${account.ticker || ''} on ${account.stock_exchange || 'a public exchange'}`,
        title: 'Public Market Listing',
        detail: `
          <div class="stat-row"><span class="stat-label">Ticker</span><span class="stat-value">${esc(account.ticker || '—')}</span></div>
          <div class="stat-row"><span class="stat-label">Exchange</span><span class="stat-value">${esc(account.stock_exchange || '—')}</span></div>
          <div class="stat-row"><span class="stat-label">Company type</span><span class="stat-value">${esc(account.company_type || '—')}</span></div>
        `
      });
    }
    if (account.last_funding_type) {
      const amt = account.total_funding_amount_usd ? `$${Number(account.total_funding_amount_usd).toLocaleString()}` : '—';
      const date = account.last_funding_date ? ` (${account.last_funding_date})` : '';
      signals.push({
        icon: 'bi-cash-coin', text: `Last funding: ${account.last_funding_type}${date}${account.total_funding_amount_usd ? ` — ${amt}` : ''}`,
        title: 'Funding History',
        detail: `
          <div class="stat-row"><span class="stat-label">Last funding type</span><span class="stat-value">${esc(account.last_funding_type)}</span></div>
          <div class="stat-row"><span class="stat-label">Date</span><span class="stat-value">${esc(account.last_funding_date || '—')}</span></div>
          <div class="stat-row"><span class="stat-label">Amount</span><span class="stat-value">${amt}</span></div>
          <div class="stat-row"><span class="stat-label">Funding rounds</span><span class="stat-value">${esc(account.num_funding_rounds ?? '—')}</span></div>
          <div class="stat-row"><span class="stat-label">Funding status</span><span class="stat-value">${esc(account.funding_status || '—')}</span></div>
        `
      });
    }
    if (account.ipo_status) {
      signals.push({
        icon: 'bi-bank2', text: `IPO status: ${account.ipo_status}`,
        title: 'IPO Status',
        detail: `
          <div class="stat-row"><span class="stat-label">Status</span><span class="stat-value">${esc(account.ipo_status)}</span></div>
          <div class="stat-row"><span class="stat-label">IPO date</span><span class="stat-value">${esc(account.ipo_date || '—')}</span></div>
        `
      });
    }
    if (account.patents_granted) {
      signals.push({ icon: 'bi-lightbulb', text: `${account.patents_granted} patent${account.patents_granted !== 1 ? 's' : ''} granted` });
    }
    if (account.active_tech_count) {
      const techSet = new Set();
      (account.lobs || []).forEach(l => (l.technologies || []).forEach(t => techSet.add(t)));
      signals.push({
        icon: 'bi-cpu', text: `${account.active_tech_count} active technologies detected${account.it_spend ? ` (IT spend: ${account.it_spend})` : ''}`,
        title: 'Technology Footprint',
        detail: `
          <div class="stat-row"><span class="stat-label">Active technologies</span><span class="stat-value">${esc(account.active_tech_count)}</span></div>
          ${account.it_spend ? `<div class="stat-row"><span class="stat-label">IT spend</span><span class="stat-value">${esc(account.it_spend)}</span></div>` : ''}
          ${techSet.size ? `<div class="dossier-label" style="margin-top:10px;">Detected across LOBs</div><div class="chip-row">${[...techSet].map(t => `<span class="chip"><i class="bi bi-cpu"></i> ${esc(t)}</span>`).join('')}</div>` : ''}
        `
      });
    }
    if (account.num_acquisitions) {
      signals.push({ icon: 'bi-briefcase', text: `${account.num_acquisitions} acquisition${account.num_acquisitions !== 1 ? 's' : ''} on record` });
    }
    if ((account.lobs || []).length > 1) {
      signals.push({
        icon: 'bi-folder2', text: `${account.lobs.length} active lines of business tracked`,
        title: 'Lines of Business',
        detail: `<div class="chip-row">${account.lobs.map(l => `<button type="button" class="chip" style="cursor:pointer;border:1px solid var(--border-color);font-family:inherit;" data-jump-lob="${l.id}" data-jump-account="${account.id}">${esc(l.name)}</button>`).join('')}</div>`
      });
    }
    if (account.total_contacts_captured) {
      const tierCounts = {};
      dedupePersonas(account.personas || []).forEach(p => { const t = tierLabel(p); tierCounts[t] = (tierCounts[t] || 0) + 1; });
      signals.push({
        icon: 'bi-people-fill', text: `${account.total_contacts_captured} contacts mapped across the org`,
        title: 'Org Coverage',
        detail: `
          <div class="chip-row" style="margin-bottom:14px;">${Object.entries(tierCounts).map(([label, n]) => `<span class="chip">${esc(label)}: ${n}</span>`).join('')}</div>
          ${renderOrgChart(account)}
        `
      });
    }
    if ((account.industries || []).length) {
      signals.push({
        icon: 'bi-tag', text: `Operates in ${account.industries.slice(0, 3).join(', ')}`,
        title: 'Industries',
        detail: `<div class="chip-row">${account.industries.map(i => `<span class="chip"><i class="bi bi-tag"></i> ${esc(i)}</span>`).join('')}</div>`
      });
    }
    const competitors = new Set();
    (lob ? [lob] : (account.lobs || [])).forEach(l => (l.competitors || []).forEach(c => competitors.add(c)));
    if (competitors.size) {
      signals.push({
        icon: 'bi-shield-exclamation', text: `Competitors tracked: ${[...competitors].slice(0, 3).join(', ')}`,
        title: 'Competitive Landscape',
        detail: `<div class="chip-row">${[...competitors].map(c => `<span class="chip"><i class="bi bi-shield-exclamation"></i> ${esc(c)}</span>`).join('')}</div>`
      });
    }
    return signals;
  }

  // ── Real content intelligence (imported posts + digests) ──────
  function renderContentPanel(account) {
    const targetKey = resolveAccountTargetKey(account);
    const posts = targetKey ? (contentStore.posts[targetKey] || []) : [];
    const digestEntry = targetKey ? contentStore.digests[targetKey] : null;
    const dryRun = isDryRunDigest(digestEntry);

    if (!targetKey || (!posts.length && !digestEntry)) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-inbox"></i></div>
        <div class="empty-block-text">No content intelligence captured yet for this account.</div>
      </div>`;
    }

    if (dryRun) {
      return renderRawPostsFallback(posts, 'This account has captured posts, but the AI digest run had no LLM configured (dry-run) — showing the raw posts instead.');
    }

    const d = digestEntry.digest || {};
    const channels = d.channels || [];
    const metaBits = [
      digestEntry.priority ? `Priority: ${digestEntry.priority}` : '',
      digestEntry.posts_considered != null ? `${digestEntry.posts_considered} posts considered` : '',
      digestEntry.generated_at ? `Generated ${timeAgo(digestEntry.generated_at)}` : ''
    ].filter(Boolean).join(' · ');

    return `
      <div class="content-meta">${esc(metaBits)}</div>
      <div class="content-channel-grid">
        ${channels.map(renderChannelCard).join('')}
      </div>
      <div class="content-provenance"><i class="bi bi-info-circle"></i> Source: ${esc(digestEntry.llm || 'unknown')}</div>
    `;
  }

  function renderChannelCard(ch) {
    const icon = CHANNEL_ICON[ch.channel] || 'bi-globe2';
    const label = ch.channel_label || CHANNEL_LABEL[ch.channel] || ch.channel;
    const strengthPill = STRENGTH_PILL[ch.evidence_strength] || '';
    const storyline = ch.storyline || {};
    const doNotSay = ch.do_not_say || [];

    return `
      <div class="content-channel-card">
        <div class="content-channel-header">
          <span class="content-channel-icon"><i class="bi ${icon}"></i></span>
          <span class="content-channel-label">${esc(label)}</span>
          ${ch.evidence_strength ? `<span class="pill ${strengthPill}">${esc(ch.evidence_strength)}</span>` : ''}
          <span class="content-channel-count">${ch.posts_considered != null ? `${ch.posts_considered} posts` : ''}</span>
        </div>

        ${ch.summary ? `<p class="content-summary">${esc(ch.summary)}</p>` : ''}

        ${(ch.observed && ch.observed.length) ? `
          <details class="content-observed">
            <summary>Observed facts (${ch.observed.length})</summary>
            ${(ch.themes && ch.themes.length) ? `<div class="chip-row" style="margin:8px 0;">${ch.themes.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
            <ul class="content-fact-list">
              ${ch.observed.map(o => `<li>${esc(o.fact)}${o.source_url ? ` <a href="${esc(o.source_url)}" target="_blank" title="Source"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}</li>`).join('')}
            </ul>
          </details>` : ''}

        ${ch.interpretation ? `<p class="content-interpretation">${esc(ch.interpretation)}</p>` : ''}

        <div class="content-fields">
          ${ch.sales_angle ? `<div class="content-field"><strong>Sales angle:</strong> ${esc(ch.sales_angle)}</div>` : ''}
          ${storyline.hook ? `<div class="content-field"><strong>Hook:</strong> ${esc(storyline.hook)}</div>` : ''}
          ${storyline.angle ? `<div class="content-field"><strong>Angle:</strong> ${esc(storyline.angle)}${storyline.suggested_tone ? ` <em>(${esc(storyline.suggested_tone)})</em>` : ''}</div>` : ''}
          ${(storyline.post_ideas && storyline.post_ideas.length) ? `<div class="content-field"><strong>Post ideas:</strong><ul>${storyline.post_ideas.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
        </div>

        ${doNotSay.length ? `
          <div class="content-warning">
            <div class="content-warning-title"><i class="bi bi-exclamation-octagon"></i> Do not say</div>
            <ul>${doNotSay.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
          </div>` : ''}
      </div>
    `;
  }

  function renderRawPostsFallback(posts, note) {
    if (!posts.length) {
      return `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-inbox"></i></div><div class="empty-block-text">${esc(note)}</div></div>`;
    }
    const byChannel = {};
    posts.forEach(p => { (byChannel[p.channel] = byChannel[p.channel] || []).push(p); });
    return `
      <div class="content-provenance" style="margin-bottom:10px;"><i class="bi bi-info-circle"></i> ${esc(note)}</div>
      <div class="chip-row">
        ${Object.entries(byChannel).map(([ch, arr]) => `<span class="chip"><i class="bi ${CHANNEL_ICON[ch] || 'bi-globe2'}"></i> ${CHANNEL_LABEL[ch] || ch}: ${arr.length}</span>`).join('')}
      </div>
    `;
  }

  function hasDossier(p) {
    return !!(p.personalized_icebreaker || p.value_proposition || p.communication_style ||
      (p.target_kpis && p.target_kpis.length) || (p.operational_pain_points && p.operational_pain_points.length) ||
      (p.key_objections && p.key_objections.length) || p.prior_company || p.degree || p.institution);
  }

  function renderDossier(p) {
    if (!hasDossier(p)) {
      return `<div class="dossier-empty">No AI call-prep dossier generated yet for ${esc(p.name || 'this contact')}. Use "Fetch" on their card in the Account Explorer to generate one.</div>`;
    }
    const chipGroup = (title, icon, items) => (items && items.length)
      ? `<div class="dossier-block"><div class="dossier-label"><i class="bi ${icon}"></i> ${esc(title)}</div><div class="chip-row">${items.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div></div>`
      : '';
    const background = [p.prior_company ? `Previously at ${p.prior_company}` : '', (p.degree || p.institution) ? `${p.degree || 'Degree'}${p.institution ? ', ' + p.institution : ''}` : '']
      .filter(Boolean).join(' • ');

    return `
      ${p.personalized_icebreaker ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-chat-quote"></i> Icebreaker</div><div class="dossier-quote">"${esc(p.personalized_icebreaker)}"</div></div>` : ''}
      ${p.value_proposition ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-bullseye"></i> Value Proposition</div><div class="dossier-text">${esc(p.value_proposition)}</div></div>` : ''}
      ${p.communication_style ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-chat-dots"></i> Communication Style</div><div class="dossier-text">${esc(p.communication_style)}</div></div>` : ''}
      ${chipGroup('Target KPIs', 'bi-flag', p.target_kpis)}
      ${chipGroup('Operational Pain Points', 'bi-exclamation-triangle', p.operational_pain_points)}
      ${chipGroup('Likely Objections', 'bi-shield-x', p.key_objections)}
      ${background ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-mortarboard"></i> Background</div><div class="dossier-text">${esc(background)}</div></div>` : ''}
    `;
  }

  function renderPostCard(post) {
    const icon = CHANNEL_ICON[post.channel] || 'bi-globe2';
    const label = CHANNEL_LABEL[post.channel] || post.channel;
    const eng = post.engagement || {};
    const engBits = [
      eng.likes != null ? `<span><i class="bi bi-hand-thumbs-up"></i> ${eng.likes}</span>` : '',
      eng.comments != null ? `<span><i class="bi bi-chat"></i> ${eng.comments}</span>` : '',
      eng.shares != null ? `<span><i class="bi bi-share"></i> ${eng.shares}</span>` : ''
    ].filter(Boolean).join('');
    const body = (post.body || '').length > 260 ? post.body.slice(0, 260) + '…' : (post.body || '');

    return `
      <div class="post-card">
        <div class="post-card-header">
          <span class="post-card-channel"><i class="bi ${icon}"></i> ${esc(label)}</span>
          ${post.published_at ? `<span class="post-card-date">${esc(post.published_at)}</span>` : ''}
        </div>
        ${post.author ? `<div class="post-card-author">${esc(post.author)}</div>` : ''}
        ${body ? `<p class="post-card-body">${esc(body)}</p>` : ''}
        <div class="post-card-footer">
          ${engBits ? `<span class="post-card-engagement">${engBits}</span>` : '<span></span>'}
          ${post.post_url ? `<a href="${esc(post.post_url)}" target="_blank">Open <i class="bi bi-box-arrow-up-right"></i></a>` : ''}
        </div>
      </div>
    `;
  }

  function renderSocialActivity(p) {
    const handles = [];
    if (p.linkedin_url) handles.push({ platform: 'LinkedIn', icon: 'bi-linkedin', url: p.linkedin_url });
    if (p.social_platform && p.social_profile_url && p.social_platform.toLowerCase() !== 'linkedin') {
      handles.push({ platform: p.social_platform, icon: 'bi-link-45deg', url: p.social_profile_url });
    }
    if (p.twitter_handle) handles.push({ platform: 'X / Twitter', icon: 'bi-twitter-x', url: `https://twitter.com/${p.twitter_handle}` });

    const targetKey = resolvePersonaTargetKey(p);
    const posts = targetKey ? (contentStore.posts[targetKey] || []) : [];
    const digestEntry = targetKey ? contentStore.digests[targetKey] : null;

    return `
      ${handles.length ? `<div class="chip-row" style="margin-bottom:10px;">${handles.map(h => `<a class="social-link" href="${esc(h.url)}" target="_blank"><i class="bi ${h.icon}"></i> ${esc(h.platform)}</a>`).join('')}</div>` : ''}
      ${p.social_presence_level ? `<div class="stat-row"><span class="stat-label">Presence level</span><span class="stat-value">${esc(p.social_presence_level)}</span></div>` : ''}
      ${renderPersonaContentSummary(digestEntry, posts)}
      ${posts.length ? `
        <div class="post-card-list">${posts.slice(0, 6).map(renderPostCard).join('')}</div>
        ${posts.length > 6 ? `<div class="people-empty">+${posts.length - 6} more captured posts</div>` : ''}
      ` : `
        <div class="empty-block" style="padding:16px 4px;">
          <div class="empty-block-icon"><i class="bi bi-inbox"></i></div>
          <div class="empty-block-text">No recent posts available. Pulling real post content needs a social-listening integration — nothing here is invented.</div>
        </div>`}
    `;
  }

  function renderPersonaContentSummary(digestEntry, posts) {
    if (!posts.length && !digestEntry) return '';

    if (digestEntry && !isDryRunDigest(digestEntry)) {
      const channels = (digestEntry.digest && digestEntry.digest.channels) || [];
      if (channels.length) {
        return `<div class="content-channel-grid" style="margin-bottom:12px;">${channels.map(renderChannelCard).join('')}</div>`;
      }
    }

    if (!posts.length) return '';

    // No usable AI digest — summarize what was actually captured, no invented text.
    const byChannel = {};
    posts.forEach(post => { (byChannel[post.channel] = byChannel[post.channel] || []).push(post); });
    const dates = posts.map(post => post.published_at).filter(Boolean);

    return `
      <div class="content-provenance" style="margin-bottom:8px;">
        <i class="bi bi-info-circle"></i> ${digestEntry ? 'AI digest wasn’t generated for this contact (no LLM configured on the source run)' : 'No AI digest generated yet'} — showing a summary of captured activity instead.
      </div>
      <div class="chip-row" style="margin-bottom:12px;">
        ${Object.entries(byChannel).map(([ch, arr]) => `<span class="chip"><i class="bi ${CHANNEL_ICON[ch] || 'bi-globe2'}"></i> ${esc(CHANNEL_LABEL[ch] || ch)}: ${arr.length}</span>`).join('')}
        ${dates.length ? `<span class="chip"><i class="bi bi-calendar3"></i> Most recent: ${esc(dates[0])}</span>` : ''}
      </div>
    `;
  }

  function renderPlaceholderProfile(reason) {
    return `<div class="empty-block" style="padding:16px 4px;">
      <div class="empty-block-icon"><i class="bi bi-slash-circle"></i></div>
      <div class="empty-block-text">${esc(reason)}</div>
    </div>`;
  }

  function renderDrawerPinned(p) {
    const tag = p.tier || p.decision_authority || (p.departments && p.departments[0]) || null;
    const dossierReady = hasDossier(p);
    return `
      <div class="drawer-contact-header">
        <div class="drawer-avatar">${esc(initials(p.name))}</div>
        <div>
          <div class="drawer-contact-name">${esc(p.name || 'Unnamed')} ${dossierReady ? '<i class="bi bi-stars" title="AI call-prep dossier available"></i>' : ''}</div>
          <div class="drawer-contact-title">${esc(p.title || 'Title unknown')}</div>
          ${tag ? `<div class="contact-tags" style="margin-top:6px;"><span class="tag">${esc(tag)}</span></div>` : ''}
        </div>
      </div>

      <div class="drawer-actions">
        <a class="drawer-action ${p.email ? '' : 'disabled'}" ${p.email ? `href="mailto:${esc(p.email)}"` : ''}><i class="bi bi-envelope"></i> Email</a>
        <a class="drawer-action ${p.phone ? '' : 'disabled'}" ${p.phone ? `href="tel:${esc(p.phone)}"` : ''}><i class="bi bi-telephone"></i> Call</a>
        <a class="drawer-action ${p.linkedin_url ? '' : 'disabled'}" ${p.linkedin_url ? `href="${esc(p.linkedin_url)}" target="_blank"` : ''}><i class="bi bi-linkedin"></i> LinkedIn</a>
      </div>

      <div class="drawer-jumpnav">
        <button type="button" class="drawer-jump-btn active" data-jump="drawer-sec-overview">Overview</button>
        <button type="button" class="drawer-jump-btn" data-jump="drawer-sec-dossier">Call Prep</button>
        <button type="button" class="drawer-jump-btn" data-jump="drawer-sec-social">Social</button>
        <button type="button" class="drawer-jump-btn" data-jump="drawer-sec-profiles">Profiles</button>
      </div>
    `;
  }

  function renderContactDrawer(p) {
    const meta = [
      p.decision_authority ? `Decision authority: ${p.decision_authority}` : '',
      p.budget_authority ? `Budget authority: ${p.budget_authority}` : '',
      p.seniority_raw ? `Seniority: ${p.seniority_raw}` : '',
      [p.city, p.state, p.country].filter(Boolean).join(', ')
    ].filter(Boolean);

    return `
      <div id="drawer-sec-overview">
        ${meta.length ? `
          <div class="drawer-section">
            <div class="drawer-section-title"><i class="bi bi-person-vcard"></i> Contact Info</div>
            ${meta.map(m => `<div class="stat-row"><span class="stat-label">${esc(m)}</span></div>`).join('')}
          </div>` : ''}

        ${(p.skills && p.skills.length) ? `
          <div class="drawer-section">
            <div class="drawer-section-title"><i class="bi bi-lightning-charge"></i> Skills &amp; Focus Areas</div>
            <div class="chip-row">${p.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
          </div>` : ''}

        ${(!meta.length && !(p.skills && p.skills.length)) ? `
          <div class="drawer-section">
            <div class="drawer-section-title"><i class="bi bi-person-vcard"></i> Contact Info</div>
            <div class="empty-block" style="padding:6px 0;"><div class="empty-block-text">No additional contact metadata captured yet.</div></div>
          </div>` : ''}
      </div>

      <div class="drawer-section" id="drawer-sec-dossier">
        <div class="drawer-section-title"><i class="bi bi-stars"></i> AI Call-Prep Dossier</div>
        ${renderDossier(p)}
      </div>

      <div class="drawer-section" id="drawer-sec-social">
        <div class="drawer-section-title"><i class="bi bi-broadcast"></i> Recent Social Media Activity</div>
        ${renderSocialActivity(p)}
      </div>

      <div id="drawer-sec-profiles">
        <div class="drawer-section drawer-section-muted">
          <div class="drawer-section-title"><i class="bi bi-activity"></i> Psychological Profile</div>
          ${renderPlaceholderProfile('Not available — no data source for psychological profiling is connected.')}
        </div>

        <div class="drawer-section drawer-section-muted">
          <div class="drawer-section-title"><i class="bi bi-person-lines-fill"></i> Personality Profile</div>
          ${renderPlaceholderProfile('Not available — no personality-assessment source (e.g. DISC/Big Five) is connected.')}
        </div>
      </div>
    `;
  }

  function openContactDrawer(p) {
    drawerTitle.textContent = p.name || 'Contact';
    drawerPinned.innerHTML = renderDrawerPinned(p);
    drawerBody.innerHTML = renderContactDrawer(p);
    drawerBody.scrollTop = 0;
    contactDrawer.classList.add('open');
    drawerBackdrop.classList.add('open');
  }

  function closeContactDrawer() {
    contactDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('open');
  }

  el('drawerClose').addEventListener('click', closeContactDrawer);
  drawerBackdrop.addEventListener('click', closeContactDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeContactDrawer();
    closeSignalModal();
  });

  function openSignalModal(signal) {
    signalModalTitle.textContent = signal.title || 'Signal Detail';
    signalModalBody.innerHTML = signal.detail || '';
    signalModalBackdrop.classList.add('open');
  }
  function closeSignalModal() {
    signalModalBackdrop.classList.remove('open');
  }
  el('signalModalClose').addEventListener('click', closeSignalModal);
  signalModalBackdrop.addEventListener('click', (e) => { if (e.target === signalModalBackdrop) closeSignalModal(); });

  // ── All LinkedIn Job Postings browser (opened from the Global Accounts Dashboard) ──
  // Filters, sort, and pagination are all applied server-side (GET /api/linkedin-jobs) so the
  // browser stays fast as the job dataset grows — the client never holds more than one page.
  async function openAllJobsPage() {
    activeView = 'allJobs';
    activeAccountId = null;
    activeLobId = null;
    activeJobDetailId = null;
    activeJobCategory = 'All';
    activeJobSearch = '';
    activeJobEmploymentType = '';
    activeJobWorkplaceType = '';
    activeJobSort = 'newest';
    activeJobPage = 1;
    renderNavTree();
    renderSelection();
    await fetchAllJobs();
  }

  async function fetchAllJobs(opts) {
    opts = opts || {};
    jobsLoading = true;
    if (activeView === 'allJobs') renderSelection();
    const params = new URLSearchParams();
    if (activeJobCategory !== 'All') params.set('category', activeJobCategory);
    if (activeJobSearch.trim()) params.set('q', activeJobSearch.trim());
    if (activeJobEmploymentType) params.set('employment_type', activeJobEmploymentType);
    if (activeJobWorkplaceType) params.set('workplace_type', activeJobWorkplaceType);
    params.set('sort', activeJobSort);
    params.set('page', String(activeJobPage));
    params.set('page_size', String(JOB_PAGE_SIZE));
    try {
      const res = await fetch(`/api/linkedin-jobs?${params.toString()}`);
      allJobsCache = await res.json();
    } catch (err) {
      allJobsCache = { total: 0, page: 1, page_size: JOB_PAGE_SIZE, total_pages: 1, categories: [], category_counts: {}, employment_types: [], workplace_types: [], jobs: [] };
    }
    jobsLoading = false;
    if (activeView === 'allJobs') {
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

  function renderAllJobsPage() {
    if (activeJobDetailId) return renderJobDetailPage();
    if (!allJobsCache) {
      return `<div class="panel"><div class="empty-block"><div class="empty-block-icon"><i class="bi bi-hourglass-split"></i></div><div class="empty-block-text">Loading job postings…</div></div></div>`;
    }
    const jobs = allJobsCache.jobs || [];
    const total = allJobsCache.total || 0;
    const totalPages = allJobsCache.total_pages || 1;
    const catCounts = allJobsCache.category_counts || {};
    const catTotal = Object.values(catCounts).reduce((s, n) => s + n, 0);
    const chips = ['All', ...(allJobsCache.categories || [])].map(c => {
      const count = c === 'All' ? catTotal : (catCounts[c] || 0);
      if (c !== 'All' && !count) return '';
      return `<button type="button" class="job-cat-chip ${activeJobCategory === c ? 'active' : ''}" data-job-category="${esc(c)}">${esc(c)} <span class="job-cat-count">${count}</span></button>`;
    }).join('');
    const employmentOptions = (allJobsCache.employment_types || []).map(t => `<option value="${esc(t)}" ${activeJobEmploymentType === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const workplaceOptions = (allJobsCache.workplace_types || []).map(t => `<option value="${esc(t)}" ${activeJobWorkplaceType === t ? 'selected' : ''}>${esc(t)}</option>`).join('');

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
            <input type="text" id="jobSearchInput" placeholder="Search title, company, or location..." value="${esc(activeJobSearch)}" autocomplete="off">
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
            <option value="newest" ${activeJobSort === 'newest' ? 'selected' : ''}>Newest first</option>
            <option value="applicants" ${activeJobSort === 'applicants' ? 'selected' : ''}>Most applicants</option>
            <option value="views" ${activeJobSort === 'views' ? 'selected' : ''}>Most views</option>
          </select>
        </div>
        <div class="job-browser-filters">${chips}</div>
        <div class="job-page-grid">
          ${jobsLoading ? `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-hourglass-split"></i></div><div class="empty-block-text">Loading…</div></div>`
            : (jobs.length ? jobs.map(j => renderJobBrowserCard(j)).join('') : `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-linkedin"></i></div><div class="empty-block-text">No job postings match your filters.</div></div>`)}
        </div>
        ${totalPages > 1 ? `
          <div class="job-pagination">
            <button type="button" class="job-page-btn" id="jobPrevPageBtn" ${activeJobPage <= 1 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i> Prev</button>
            <span class="job-page-status">Page ${allJobsCache.page} of ${totalPages}</span>
            <button type="button" class="job-page-btn" id="jobNextPageBtn" ${activeJobPage >= totalPages ? 'disabled' : ''}>Next <i class="bi bi-chevron-right"></i></button>
          </div>` : ''}
      </div>
    `;
  }

  function renderJobDetailPage() {
    const cached = jobDetailCache[activeJobDetailId];
    return `
      <button type="button" class="job-detail-back" id="jobDetailBackBtn"><i class="bi bi-arrow-left"></i> Back to all job postings</button>
      <div class="panel">
        ${cached ? buildJobDetailHtml(cached) : `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-hourglass-split"></i></div><div class="empty-block-text">Loading job details…</div></div>`}
      </div>
    `;
  }

  async function openJobDetail(jobId) {
    activeJobDetailId = jobId;
    renderSelection();
    if (jobDetailCache[jobId]) return;
    try {
      const res = await fetch(`/api/linkedin-jobs/${jobId}`);
      if (res.ok) jobDetailCache[jobId] = await res.json();
    } catch (err) { /* stays on the loading state; user can go back */ }
    if (activeJobDetailId === jobId) renderSelection();
  }

  function renderJobBrowserCard(job) {
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

  function buildJobDetailHtml(job) {
    return `
      ${renderJobCard(job, { showAccountLink: !!job.account_id, accountId: job.account_id, accountName: job.account_name })}
      ${job.description ? `<div class="job-detail-description">
        <div class="job-detail-description-title">Full description</div>
        ${job.description.split('\n').filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}
      </div>` : ''}
    `;
  }

  signalModalBody.addEventListener('click', function (e) {
    const jumpBtn = e.target.closest('[data-jump-account]');
    if (jumpBtn) {
      closeSignalModal();
      jumpToAccount(Number(jumpBtn.dataset.jumpAccount));
    }
  });

  dashContent.addEventListener('click', function (e) {
    const detailBackBtn = e.target.closest('#jobDetailBackBtn');
    if (detailBackBtn) {
      activeJobDetailId = null;
      renderSelection();
      return;
    }
    const backBtn = e.target.closest('#jobsPageBackBtn');
    if (backBtn) {
      activeView = null;
      activeJobDetailId = null;
      renderNavTree();
      renderSelection();
      return;
    }
    const chip = e.target.closest('[data-job-category]');
    if (chip) {
      activeJobCategory = chip.dataset.jobCategory;
      activeJobPage = 1;
      fetchAllJobs();
      return;
    }
    const prevBtn = e.target.closest('#jobPrevPageBtn');
    if (prevBtn && !prevBtn.disabled) {
      activeJobPage = Math.max(1, activeJobPage - 1);
      fetchAllJobs();
      return;
    }
    const nextBtn = e.target.closest('#jobNextPageBtn');
    if (nextBtn && !nextBtn.disabled) {
      activeJobPage += 1;
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
    activeJobSearch = e.target.value;
    activeJobPage = 1;
    clearTimeout(jobSearchDebounceTimer);
    jobSearchDebounceTimer = setTimeout(() => fetchAllJobs({ focusSearch: true }), 350);
  });

  dashContent.addEventListener('change', function (e) {
    if (e.target.id === 'jobEmploymentTypeFilter') {
      activeJobEmploymentType = e.target.value;
    } else if (e.target.id === 'jobWorkplaceTypeFilter') {
      activeJobWorkplaceType = e.target.value;
    } else if (e.target.id === 'jobSortSelect') {
      activeJobSort = e.target.value;
    } else {
      return;
    }
    activeJobPage = 1;
    fetchAllJobs();
  });

  dashContent.addEventListener('click', async function (e) {
    // Tab switcher
    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn && tabBtn.dataset.tab) {
      activeSalesTab = tabBtn.dataset.tab;
      renderSelection();
      return;
    }

    // Quick Arsenal Actions
    const icebreakerBtn = e.target.closest('#copyIcebreakerBtn');
    if (icebreakerBtn) {
      const account = accounts.find(a => a.id === activeAccountId);
      if (account) {
        const text = getTopIcebreakerText(account);
        try {
          await navigator.clipboard.writeText(text);
          showToast('Copied personalized icebreaker to clipboard!');
        } catch (err) {
          showToast('Failed to copy. Clipboard permission required.');
        }
      }
      return;
    }

    const emailPitchBtn = e.target.closest('#copyEmailPitchBtn');
    if (emailPitchBtn) {
      const account = accounts.find(a => a.id === activeAccountId);
      if (account) {
        const entries = getAccountContentEntries(account);
        const matches = matchOfferings(entries);
        const text = getColdEmailPitchText(account, matches);
        try {
          await navigator.clipboard.writeText(text);
          showToast('Copied customized cold pitch email template!');
        } catch (err) {
          showToast('Failed to copy. Clipboard permission required.');
        }
      }
      return;
    }

    const cheatSheetBtn = e.target.closest('#copyCheatSheetBtn');
    if (cheatSheetBtn) {
      const account = accounts.find(a => a.id === activeAccountId);
      if (account) {
        const lob = activeLobId ? (account.lobs || []).find(l => l.id === activeLobId) : null;
        const text = getAccountCheatSheetText(account, lob);
        try {
          await navigator.clipboard.writeText(text);
          showToast('Copied account battlecard & committee summary!');
        } catch (err) {
          showToast('Failed to copy. Clipboard permission required.');
        }
      }
      return;
    }

    // Persona trigger in committee tab
    const personaCard = e.target.closest('[data-open-persona]');
    if (personaCard) {
      const pName = personaCard.dataset.openPersona;
      const account = accounts.find(a => a.id === activeAccountId);
      if (account) {
        const p = dedupePersonas(account.personas || []).find(x => x.name === pName);
        if (p) openContactDrawer(p);
      }
      return;
    }

    // Signal trigger
    const chip = e.target.closest('[data-signal-idx]');
    if (chip) { const s = currentSignals[Number(chip.dataset.signalIdx)]; if (s) openSignalModal(s); return; }
    
    // Jump LOB trigger
    const lobBtn = e.target.closest('[data-jump-lob]');
    if (lobBtn) {
      activeAccountId = Number(lobBtn.dataset.jumpAccount);
      activeLobId = Number(lobBtn.dataset.jumpLob);
      expandedAccountIds.add(activeAccountId);
      closeSignalModal();
      renderNavTree();
      renderSelection();
    }
  });

  signalModalBody.addEventListener('click', async function (e) {
    const btn = e.target.closest('#fetchSecBtn');
    if (!btn) return;
    const cik = btn.dataset.cik;
    const resultEl = el('secFetchResult');
    if (!cik) { resultEl.innerHTML = `<div class="content-provenance"><i class="bi bi-exclamation-triangle"></i> No SEC CIK on file for this account.</div>`; return; }
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Fetching…';
    try {
      const res = await fetch('/api/account/sec-10k-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sec_cik: cik, chunk_size: 1500, overlap: 200 })
      });
      const data = await res.json();
      if (data.status !== 'success') {
        resultEl.innerHTML = `<div class="content-provenance"><i class="bi bi-exclamation-triangle"></i> ${esc(data.message || 'No filing text available.')}</div>`;
        return;
      }
      const bySection = {};
      (data.chunks || []).forEach(c => { (bySection[c.section] = bySection[c.section] || []).push(c); });
      resultEl.innerHTML = `
        <div class="content-provenance" style="margin:10px 0;"><i class="bi bi-check-circle"></i> ${data.filing_type} filed ${esc(data.filing_date || '')} — <a href="${esc(data.primary_document_url)}" target="_blank">open original filing <i class="bi bi-box-arrow-up-right"></i></a></div>
        ${Object.entries(bySection).map(([section, chunks]) => `
          <details class="content-observed">
            <summary>${esc(section)} (${chunks.length} chunk${chunks.length !== 1 ? 's' : ''})</summary>
            ${chunks.slice(0, 3).map(c => `<p class="content-summary" style="margin-top:8px;">${esc(c.text.slice(0, 500))}${c.text.length > 500 ? '…' : ''}</p>`).join('')}
          </details>
        `).join('')}
      `;
    } catch (err) {
      resultEl.innerHTML = `<div class="content-provenance"><i class="bi bi-exclamation-triangle"></i> Fetch failed: ${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-cloud-arrow-down"></i> Fetch full filing text';
    }
  });

  contactDrawer.addEventListener('click', function (e) {
    const jumpBtn = e.target.closest('[data-jump]');
    if (!jumpBtn) return;
    const target = drawerBody.querySelector(`#${jumpBtn.dataset.jump}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    drawerPinned.querySelectorAll('.drawer-jump-btn').forEach(b => b.classList.remove('active'));
    jumpBtn.classList.add('active');
  });

  function renderContactsList(personas) {
    currentPersonas = personas;
    if (!personas.length) return '<div class="people-empty">No contacts match.</div>';
    return personas.slice(0, 12).map((p, idx) => {
      const tag = p.tier || p.decision_authority || (p.departments && p.departments[0]) || null;
      const dossierReady = hasDossier(p);
      return `
        <div class="contact-card">
          <button type="button" class="contact-main" data-contact-idx="${idx}" title="View full contact details">
            <div class="contact-avatar">${esc(initials(p.name))}</div>
            <div class="contact-body">
              <div class="contact-name">${esc(p.name || 'Unnamed')} ${dossierReady ? '<i class="bi bi-stars dossier-badge" title="AI call-prep dossier available"></i>' : ''}</div>
              <div class="contact-title">${esc(p.title || 'Title unknown')}</div>
              ${tag ? `<div class="contact-tags"><span class="tag">${esc(tag)}</span></div>` : ''}
            </div>
            <span class="contact-chevron"><i class="bi bi-chevron-right"></i></span>
          </button>
          <div class="contact-actions">
            <a class="icon-btn ${p.email ? '' : 'disabled'}" ${p.email ? `href="mailto:${esc(p.email)}"` : ''} title="${p.email ? 'Email ' + esc(p.name) : 'No email on file'}"><i class="bi bi-envelope"></i></a>
            <a class="icon-btn ${p.phone ? '' : 'disabled'}" ${p.phone ? `href="tel:${esc(p.phone)}"` : ''} title="${p.phone ? 'Call ' + esc(p.name) : 'No phone on file'}"><i class="bi bi-telephone"></i></a>
            <a class="icon-btn ${p.linkedin_url ? '' : 'disabled'}" ${p.linkedin_url ? `href="${esc(p.linkedin_url)}" target="_blank"` : ''} title="${p.linkedin_url ? 'LinkedIn' : 'No LinkedIn on file'}"><i class="bi bi-linkedin"></i></a>
          </div>
        </div>`;
    }).join('') + (personas.length > 12 ? `<div class="people-empty">+${personas.length - 12} more contacts — refine your search to narrow it down</div>` : '');
  }

  function filterContacts(personas, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return personas;
    return personas.filter(p => (p.name || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));
  }

  function renderPeople(account, lob) {
    const personas = getPersonasFor(account, lob);
    allAccountPersonas = personas;
    const tech = getTechFor(account, lob);

    const socialLinks = [
      account.linkedin_url ? { label: 'LinkedIn', icon: 'bi-linkedin', url: account.linkedin_url } : null,
      account.twitter_url ? { label: 'X / Twitter', icon: 'bi-twitter-x', url: account.twitter_url } : (account.twitter_handle ? { label: 'X / Twitter', icon: 'bi-twitter-x', url: `https://twitter.com/${account.twitter_handle}` } : null),
      account.blog_url ? { label: 'Blog', icon: 'bi-journal-richtext', url: account.blog_url } : null,
      account.github_url ? { label: 'GitHub', icon: 'bi-github', url: account.github_url } : null,
      account.glassdoor_url ? { label: 'Glassdoor', icon: 'bi-building', url: account.glassdoor_url } : null,
      account.website_url ? { label: 'Website', icon: 'bi-globe2', url: account.website_url } : null
    ].filter(Boolean);

    return `
      <!-- Key Contacts Section -->
      <div class="panel-title" style="margin-top:2px;">
        <span><i class="bi bi-person-lines-fill"></i> Key Contacts</span>
        <span class="context-badge live">${personas.length} mapped</span>
      </div>
      <p class="section-desc" style="margin-bottom:8px;">Executive stakeholders &amp; decision makers. Click any card to open the AI Call-Prep Dossier.</p>
      
      <div class="contact-search">
        <i class="bi bi-search"></i>
        <input type="text" id="contactSearchInput" placeholder="Filter contacts by name or title..." autocomplete="off">
      </div>
      <div id="contactsListContainer">${renderContactsList(personas)}</div>

      <!-- Social & Web Footprint Section -->
      <div class="panel-title" style="margin-top:18px;">
        <span><i class="bi bi-globe"></i> Social &amp; Web Footprint</span>
      </div>
      <p class="section-desc" style="margin-bottom:8px;">Verified corporate web properties and active public discourse channels.</p>
      ${socialLinks.length ? `<div class="social-links">${socialLinks.map(s => `<a class="social-link" href="${esc(s.url)}" target="_blank" title="Open ${esc(s.label)} profile"><i class="bi ${s.icon}"></i> ${esc(s.label)}</a>`).join('')}</div>`
        : '<div class="people-empty">No social/web links on file.</div>'}

      <!-- Detected Tech Stack Section -->
      <div class="panel-title" style="margin-top:18px;">
        <span><i class="bi bi-cpu-fill"></i> Detected Tech Stack</span>
        <span class="context-badge ai">${tech.length} items</span>
      </div>
      <p class="section-desc" style="margin-bottom:8px;">Technologies, frameworks, and cloud platforms detected across operating segments.</p>
      <div class="chip-row" style="margin-bottom:12px;">
        ${tech.length ? tech.map(t => `<span class="chip" title="Active technology in stack"><i class="bi bi-cpu"></i> ${esc(t)}</span>`).join('') : '<span class="chip">No tech stack detected yet</span>'}
      </div>

      <!-- Quick Actions Section -->
      <div class="panel-title" style="margin-top:18px;">
        <span><i class="bi bi-tools"></i> Account Actions</span>
      </div>
      <p class="section-desc" style="margin-bottom:8px;">Enrich tech telemetry or navigate to the deep Account Explorer pipeline.</p>
      <button type="button" class="action-btn" id="fetchDiffbotBtn" data-acct="${account.id}" title="Run live Diffbot scraping to identify technologies and company attributes"><i class="bi bi-cloud-arrow-down"></i> Enrich with Diffbot Intel</button>
      <button type="button" class="action-btn secondary" id="openExplorerBtn" data-name="${esc(account.name)}" title="Jump to Account Explorer for deep scraping workflow"><i class="bi bi-box-arrow-up-right"></i> Open in Account Explorer</button>
    `;
  }

  dashPeople.addEventListener('input', function (e) {
    if (e.target.id !== 'contactSearchInput') return;
    const filtered = filterContacts(allAccountPersonas, e.target.value);
    el('contactsListContainer').innerHTML = renderContactsList(filtered);
  });

  dashPeople.addEventListener('click', async function (e) {
    const contactBtn = e.target.closest('[data-contact-idx]');
    if (contactBtn) {
      const p = currentPersonas[Number(contactBtn.dataset.contactIdx)];
      if (p) openContactDrawer(p);
      return;
    }
    const diffbotBtn = e.target.closest('#fetchDiffbotBtn');
    if (diffbotBtn) {
      const account = accounts.find(a => a.id === Number(diffbotBtn.dataset.acct));
      if (!account) return;
      diffbotBtn.disabled = true;
      diffbotBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Fetching…';
      try {
        const res = await fetch('/api/account/diffbot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_name: account.name, target_url: account.website_url || null })
        });
        if (!res.ok) throw new Error('Diffbot request failed');
        const data = await res.json();
        const techs = (data.technologies || []).filter(Boolean);
        if (techs.length) {
          extraTech[account.id] = [...new Set([...(extraTech[account.id] || []), ...techs])];
          showToast(`Diffbot found ${techs.length} technolog${techs.length === 1 ? 'y' : 'ies'} for ${account.name}`);
        } else {
          showToast(`Diffbot returned no new technology data for ${account.name}`);
        }
      } catch (err) {
        console.error(err);
        showToast('Diffbot lookup failed. Check the API server logs.');
      } finally {
        renderSelection();
      }
      return;
    }
    const explorerBtn = e.target.closest('#openExplorerBtn');
    if (explorerBtn) {
      try { await navigator.clipboard.writeText(explorerBtn.dataset.name); } catch (err) {}
      showToast('Account name copied — paste it into the Explorer search bar');
      window.open('/pipline/', '_blank');
    }
  });

  loadAccounts();
})();
