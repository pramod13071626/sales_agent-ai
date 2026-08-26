(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const navTree = el('navTree');
  const navFilters = el('navFilters');
  const navSearch = el('navSearch');
  const dashEmpty = el('dashEmpty');
  const dashContent = el('dashContent');
  const dashPeople = el('dashPeople');
  const toastEl = el('toast');
  const contactDrawer = el('contactDrawer');
  const drawerBackdrop = el('drawerBackdrop');
  const drawerTitle = el('drawerTitle');
  const drawerPinned = el('drawerPinned');
  const drawerBody = el('drawerBody');

  let accounts = [];
  let expandedAccountIds = new Set();
  let activeAccountId = null;
  let activeLobId = null;
  let extraTech = {}; // accountId -> [] technologies fetched live via Diffbot, not persisted
  let currentPersonas = []; // personas currently rendered in the right panel, indexed for the drawer
  let contentStore = { digests: {}, posts: {} }; // real scraped posts + LLM digests, keyed by target_key

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

  // ── Quick filter chips (disabled — fields not in the current data model) ──
  const PLACEHOLDER_FILTERS = [
    { icon: 'bi-bullseye', label: 'Intent', reason: 'Needs an intent-scoring backend (not tracked yet)' },
    { icon: 'bi-graph-up', label: 'Engagement', reason: 'Needs activity-tracking data (not tracked yet)' },
    { icon: 'bi-check2-circle', label: 'ICP Match', reason: 'Needs ICP-scoring backend (not tracked yet)' },
    { icon: 'bi-cash-stack', label: 'ARR', reason: 'Needs a CRM ARR field (not tracked yet)' },
    { icon: 'bi-exclamation-triangle', label: 'Risk Flags', reason: 'Needs risk-flag data (not tracked yet)' }
  ];
  navFilters.innerHTML = PLACEHOLDER_FILTERS.map(f =>
    `<button type="button" class="filter-chip" disabled title="${esc(f.reason)}"><i class="bi ${f.icon}"></i> ${esc(f.label)}</button>`
  ).join('');

  // ── Data loading ─────────────────────────────────────────────
  async function loadAccounts() {
    try {
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

      renderNavTree();
      if (!activeAccountId) renderDigest();
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

    dashEmpty.innerHTML = `
      <div class="digest-header">
        <h2 class="digest-title"><i class="bi bi-bar-chart-line"></i> Weekly Account Digest</h2>
        <p class="digest-sub">Live summary built from your ${accounts.length} tracked account${accounts.length !== 1 ? 's' : ''} — not a preset report, this recalculates from current data every time you load the page.</p>
      </div>

      <div class="digest-grid-2">
        <div class="panel">
          <div class="panel-title">Recently Updated Accounts</div>
          ${recentlyUpdated.length ? recentlyUpdated.map(a => `
            <div class="digest-list-row">
              <span class="digest-list-name">${esc(a.name)}</span>
              <span class="digest-list-meta">${esc(timeAgo(a.extracted_at))}</span>
            </div>`).join('') : '<div class="empty-block" style="padding:10px 0;"><div class="empty-block-text">No extraction timestamps recorded yet.</div></div>'}
        </div>

        <div class="panel">
          <div class="panel-title">Most-Mapped Accounts</div>
          ${topByContacts.length ? topByContacts.map(a => `
            <div class="digest-list-row">
              <span class="digest-list-name">${esc(a.name)}</span>
              <span class="digest-list-meta">${a.total_contacts_captured || 0} contacts</span>
            </div>`).join('') : '<div class="empty-block" style="padding:10px 0;"><div class="empty-block-text">No contacts mapped yet.</div></div>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Org Coverage Across All Accounts</div>
        <div class="chip-row">
          <span class="chip"><i class="bi bi-award"></i> ${cSuite} C-Suite</span>
          <span class="chip"><i class="bi bi-graph-up-arrow"></i> ${vp} VPs</span>
          <span class="chip"><i class="bi bi-compass"></i> ${director} Directors</span>
          <span class="chip"><i class="bi bi-tools"></i> ${manager} Managers</span>
          <span class="chip"><i class="bi bi-bullseye"></i> ${scoredCount}/${accounts.length} accounts have an opportunity score</span>
        </div>
      </div>

      ${industries.size ? `
        <div class="panel">
          <div class="panel-title">Industries Covered</div>
          <div class="chip-row">${[...industries].slice(0, 12).map(i => `<span class="chip"><i class="bi bi-tag"></i> ${esc(i)}</span>`).join('')}</div>
        </div>` : ''}

      <div class="panel">
        <div class="panel-title">Social &amp; Content Intelligence</div>
        ${renderContentDigestSummary()}
      </div>

      <div class="panel">
        <div class="panel-title">Sales Alerts <span class="panel-note">StradIT service-line fit, across all accounts</span></div>
        ${renderGlobalSalesAlerts()}
      </div>

      <div class="digest-cta"><i class="bi bi-arrow-left-circle"></i> Select an account from the left panel to open its full intelligence profile.</div>
    `;
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

  // ── Left: Navigator tree ─────────────────────────────────────
  function renderNavTree() {
    const q = (navSearch.value || '').trim().toLowerCase();
    const filtered = accounts.filter(a => !q || (a.name || '').toLowerCase().includes(q));

    if (!filtered.length) {
      navTree.innerHTML = '<div class="nav-empty">No accounts match your search.</div>';
      return;
    }

    navTree.innerHTML = filtered.map(a => {
      const isOpen = expandedAccountIds.has(a.id);
      const isActive = activeAccountId === a.id && !activeLobId;
      const lobs = a.lobs || [];
      const lobsHtml = isOpen ? `
        <div class="nav-lobs">
          ${lobs.map(l => `
            <button type="button" class="nav-lob-row ${activeLobId === l.id ? 'active' : ''}" data-acct="${a.id}" data-lob="${l.id}">
              <i class="bi bi-folder2"></i> ${esc(l.name)}
            </button>
            ${(l.subLobs || []).length ? `<div class="nav-sublobs">${(l.subLobs || []).map(s => `<div class="nav-sublob-row">${esc(s.name)}</div>`).join('')}</div>` : ''}
          `).join('') || '<div class="nav-sublob-row">No lines of business</div>'}
        </div>` : '';

      return `
        <div class="nav-account">
          <button type="button" class="nav-account-row ${isActive ? 'active' : ''}" data-acct="${a.id}">
            <span class="nav-caret ${isOpen ? 'open' : ''}"><i class="bi bi-chevron-right"></i></span>
            <span class="nav-avatar">${esc(initials(a.name))}</span>
            <span class="nav-account-name">${esc(a.name)}</span>
            <span class="nav-account-count">${lobs.length}</span>
          </button>
          ${lobsHtml}
        </div>`;
    }).join('');
  }

  navSearch.addEventListener('input', renderNavTree);

  navTree.addEventListener('click', function (e) {
    const lobBtn = e.target.closest('.nav-lob-row');
    if (lobBtn) {
      activeAccountId = Number(lobBtn.dataset.acct);
      activeLobId = Number(lobBtn.dataset.lob);
      renderNavTree();
      renderSelection();
      return;
    }
    const acctBtn = e.target.closest('.nav-account-row');
    if (acctBtn) {
      const id = Number(acctBtn.dataset.acct);
      if (expandedAccountIds.has(id)) expandedAccountIds.delete(id);
      else expandedAccountIds.add(id);
      activeAccountId = id;
      activeLobId = null;
      renderNavTree();
      renderSelection();
    }
  });

  function jumpToAccount(id) {
    expandedAccountIds.add(id);
    activeAccountId = id;
    activeLobId = null;
    renderNavTree();
    renderSelection();
  }
  dashEmpty.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-jump-account]');
    if (btn) jumpToAccount(Number(btn.dataset.jumpAccount));
  });

  // ── Center + Right: render selection ──────────────────────────
  function renderSelection() {
    closeContactDrawer();
    const account = accounts.find(a => a.id === activeAccountId);
    if (!account) {
      dashEmpty.classList.remove('d-none');
      dashContent.classList.add('d-none');
      dashPeople.innerHTML = '<div class="people-empty">Select an account to see key contacts, social presence, and tech stack.</div>';
      renderDigest();
      return;
    }
    const lob = activeLobId ? (account.lobs || []).find(l => l.id === activeLobId) : null;

    dashEmpty.classList.add('d-none');
    dashContent.classList.remove('d-none');
    dashContent.innerHTML = renderCenter(account, lob);
    dashPeople.innerHTML = renderPeople(account, lob);
  }

  function renderCenter(account, lob) {
    const industries = (account.industries || []).slice(0, 6);
    const signals = computeSignals(account, lob);

    return `
      <div class="panel">
        <div class="acct-header">
          <div class="acct-avatar-lg">${esc(initials(account.name))}</div>
          <div class="acct-header-body">
            <h2 class="acct-name">${esc(account.name)}${lob ? ' · ' + esc(lob.name) : ''}</h2>
            <div class="acct-pills">
              <span class="pill pill-brand">${esc(account.ticker || 'Private')}</span>
              <span class="pill">${esc(account.revenue || 'Revenue N/A')}</span>
              <span class="pill pill-success">${esc(account.location || 'Location N/A')}</span>
              ${account.operating_status ? `<span class="pill">${esc(account.operating_status)}</span>` : ''}
            </div>
            <p class="acct-desc">${esc(lob ? (lob.desc || 'No description available.') : (account.desc || 'No description available.'))}</p>
          </div>
          ${renderScoreRing(account)}
        </div>
        ${renderTrendPill(account)}
      </div>

      <div class="panel">
        <div class="panel-title">Key Metrics <span class="panel-note">not tracked yet — needs CRM integration</span></div>
        <div class="metrics-grid">
          <div class="metric-tile"><div class="metric-value">—</div><div class="metric-label">Pipeline Value</div></div>
          <div class="metric-tile"><div class="metric-value">—</div><div class="metric-label">Active Opportunities</div></div>
          <div class="metric-tile"><div class="metric-value">—</div><div class="metric-label">Engagement Rate</div></div>
          <div class="metric-tile"><div class="metric-value">—</div><div class="metric-label">Avg Response Time</div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Firmographics</div>
        <div class="chip-row">
          ${account.founded_year ? `<span class="chip"><i class="bi bi-calendar3"></i> Founded ${esc(account.founded_year)}</span>` : ''}
          ${account.employee_count_range ? `<span class="chip"><i class="bi bi-people"></i> ${esc(account.employee_count_range)}</span>` : ''}
          ${account.company_type ? `<span class="chip"><i class="bi bi-building"></i> ${esc(account.company_type)}</span>` : ''}
          ${(account.lobs || []).length ? `<span class="chip"><i class="bi bi-folder2"></i> ${account.lobs.length} line${account.lobs.length !== 1 ? 's' : ''} of business</span>` : ''}
          ${industries.map(i => `<span class="chip"><i class="bi bi-tag"></i> ${esc(i)}</span>`).join('')}
          ${(!account.founded_year && !account.employee_count_range && !industries.length) ? '<span class="chip">No firmographic data captured yet</span>' : ''}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Engagement &amp; Digital Signals</div>
        ${renderEngagementPanel(account)}
      </div>

      ${!lob ? `
        <div class="panel">
          <div class="panel-title">Sales Alerts <span class="panel-note">StradIT service-line fit</span></div>
          ${renderSalesAlerts(account)}
        </div>` : ''}

      <div class="panel">
        <div class="panel-title">Account Signals</div>
        ${signals.length ? signals.map(s => `<div class="signal-chip"><span class="signal-icon"><i class="bi ${s.icon}"></i></span><span>${esc(s.text)}</span></div>`).join('')
          : `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-search"></i></div><div class="empty-block-text">No signals detected yet for this ${lob ? 'line of business' : 'account'}.</div></div>`}
      </div>

      ${!lob ? `
        <div class="panel">
          <div class="panel-title">Social &amp; Content Intelligence</div>
          ${renderContentPanel(account)}
        </div>` : ''}
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
    if (account.company_type === 'Public') {
      signals.push({ icon: 'bi-graph-up-arrow', text: `Publicly traded — ${account.ticker || ''} on ${account.stock_exchange || 'a public exchange'}` });
    }
    if (account.last_funding_type) {
      const amt = account.total_funding_amount_usd ? ` — $${Number(account.total_funding_amount_usd).toLocaleString()}` : '';
      const date = account.last_funding_date ? ` (${account.last_funding_date})` : '';
      signals.push({ icon: 'bi-cash-coin', text: `Last funding: ${account.last_funding_type}${date}${amt}` });
    }
    if (account.ipo_status) {
      signals.push({ icon: 'bi-bank2', text: `IPO status: ${account.ipo_status}` });
    }
    if (account.patents_granted) {
      signals.push({ icon: 'bi-lightbulb', text: `${account.patents_granted} patent${account.patents_granted !== 1 ? 's' : ''} granted` });
    }
    if (account.active_tech_count) {
      signals.push({ icon: 'bi-cpu', text: `${account.active_tech_count} active technologies detected${account.it_spend ? ` (IT spend: ${account.it_spend})` : ''}` });
    }
    if (account.num_acquisitions) {
      signals.push({ icon: 'bi-briefcase', text: `${account.num_acquisitions} acquisition${account.num_acquisitions !== 1 ? 's' : ''} on record` });
    }
    if ((account.lobs || []).length > 1) {
      signals.push({ icon: 'bi-folder2', text: `${account.lobs.length} active lines of business tracked` });
    }
    if (account.total_contacts_captured) {
      signals.push({ icon: 'bi-people-fill', text: `${account.total_contacts_captured} contacts mapped across the org` });
    }
    if ((account.industries || []).length) {
      signals.push({ icon: 'bi-tag', text: `Operates in ${account.industries.slice(0, 3).join(', ')}` });
    }
    const competitors = new Set();
    (lob ? [lob] : (account.lobs || [])).forEach(l => (l.competitors || []).forEach(c => competitors.add(c)));
    if (competitors.size) {
      signals.push({ icon: 'bi-shield-exclamation', text: `Competitors tracked: ${[...competitors].slice(0, 3).join(', ')}` });
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContactDrawer(); });

  contactDrawer.addEventListener('click', function (e) {
    const jumpBtn = e.target.closest('[data-jump]');
    if (!jumpBtn) return;
    const target = drawerBody.querySelector(`#${jumpBtn.dataset.jump}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    drawerPinned.querySelectorAll('.drawer-jump-btn').forEach(b => b.classList.remove('active'));
    jumpBtn.classList.add('active');
  });

  function renderPeople(account, lob) {
    const personas = getPersonasFor(account, lob);
    currentPersonas = personas;
    const tech = getTechFor(account, lob);

    const socialLinks = [
      account.linkedin_url ? { label: 'LinkedIn', icon: 'bi-linkedin', url: account.linkedin_url } : null,
      account.twitter_url ? { label: 'X / Twitter', icon: 'bi-twitter-x', url: account.twitter_url } : (account.twitter_handle ? { label: 'X / Twitter', icon: 'bi-twitter-x', url: `https://twitter.com/${account.twitter_handle}` } : null),
      account.blog_url ? { label: 'Blog', icon: 'bi-journal-richtext', url: account.blog_url } : null,
      account.github_url ? { label: 'GitHub', icon: 'bi-github', url: account.github_url } : null,
      account.glassdoor_url ? { label: 'Glassdoor', icon: 'bi-building', url: account.glassdoor_url } : null,
      account.website_url ? { label: 'Website', icon: 'bi-globe2', url: account.website_url } : null
    ].filter(Boolean);

    const contactsHtml = personas.length ? personas.slice(0, 12).map((p, idx) => {
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
    }).join('') + (personas.length > 12 ? `<div class="people-empty">+${personas.length - 12} more contacts</div>` : '')
      : '<div class="people-empty">No contacts mapped yet.</div>';

    return `
      <div class="panel-title" style="margin-top:2px;">Key Contacts <span class="panel-note">${personas.length}</span></div>
      ${contactsHtml}

      <div class="panel-title" style="margin-top:16px;">Social &amp; Web</div>
      ${socialLinks.length ? `<div class="social-links">${socialLinks.map(s => `<a class="social-link" href="${esc(s.url)}" target="_blank"><i class="bi ${s.icon}"></i> ${esc(s.label)}</a>`).join('')}</div>`
        : '<div class="people-empty">No social/web links on file.</div>'}

      <div class="panel-title" style="margin-top:16px;">Detected Tech Stack</div>
      <div class="chip-row" style="margin-bottom:10px;">
        ${tech.length ? tech.map(t => `<span class="chip"><i class="bi bi-cpu"></i> ${esc(t)}</span>`).join('') : '<span class="chip">No tech stack detected yet</span>'}
      </div>

      <div class="panel-title" style="margin-top:16px;">Quick Actions</div>
      <button type="button" class="action-btn" id="fetchDiffbotBtn" data-acct="${account.id}"><i class="bi bi-cloud-arrow-down"></i> Fetch Diffbot Intel</button>
      <button type="button" class="action-btn secondary" id="openExplorerBtn" data-name="${esc(account.name)}"><i class="bi bi-box-arrow-up-right"></i> Open in Account Explorer</button>
    `;
  }

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
