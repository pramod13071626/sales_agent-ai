$(function () {
  
  // ─── Theme Toggle ───────────────────────────────────────────────────────
  let savedTheme = null;
  try { savedTheme = localStorage.getItem('scraperTheme'); } catch(e) {}
  if (savedTheme) {
    $('html').attr('data-theme', savedTheme);
    $('#themeToggle').text(savedTheme === 'dark' ? '☀️' : '🌙');
  }

  $('#themeToggle').on('click', function () {
    const next = $('html').attr('data-theme') === 'dark' ? 'light' : 'dark';
    $('html').attr('data-theme', next);
    $(this).text(next === 'dark' ? '☀️' : '🌙');
    try { localStorage.setItem('scraperTheme', next); } catch(e) {}
  });

  // ─── Mobile Sidebar ─────────────────────────────────────────────────────
  function closeSidebar() {
    $('#sidebar').removeClass('open');
    $('#sidebarOverlay').removeClass('open');
  }
  $('#sidebarToggle').on('click', function () {
    $('#sidebar').toggleClass('open');
    $('#sidebarOverlay').toggleClass('open');
  });
  $('#sidebarOverlay').on('click', closeSidebar);


  // ─── Fetch Live Data ──────────────────────────────────────────────────
  let MOCK_DATA = { accounts: [] };
  let activeAccount = null;
  let activeLob = null;
  let activePersona = null;
  let stagedDataStore = {};
  let actionStateStore = {}; // key -> { pulled: bool, validated: bool, dumped: bool, score: number, message: string }

  function getActionState(key) {
    if (!actionStateStore[key]) {
      actionStateStore[key] = { pulled: false, validated: false, dumped: false, score: null, message: "" };
    }
    return actionStateStore[key];
  }

  // Exposes live selection state to the chatbot widget (chatbot.js), which
  // runs outside this closure and has no other way to read these variables.
  window.getSalesAssistantContext = function () {
    return {
      accounts: MOCK_DATA.accounts || [],
      account: activeAccount,
      lob: activeLob,
      persona: activePersona
    };
  };

  async function loadData() {
    try {
      const response = await fetch('/api/accounts');
      if (!response.ok) throw new Error('Failed to fetch data');
      const data = await response.json();
      MOCK_DATA = data;
      renderSidebar();
    } catch (err) {
      console.error(err);
      $('#accountList').html('<div style="padding:12px 10px;font-size:.85rem;color:red;">Error loading accounts. Ensure API is running.</div>');
    }
  }

  // ─── UI Rendering Logic ─────────────────────────────────────────────────

  function getInitials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  function esc(s) {
    return $('<div>').text(s == null ? '' : s).html();
  }

  // 1. Render Sidebar Accounts
  function renderSidebar(filterQuery = "") {
    const $list = $('#accountList').empty();
    const q = (filterQuery || "").trim().toLowerCase();
    let count = 0;

    (MOCK_DATA.accounts || []).forEach(acct => {
      const acctName = acct.name || 'Unnamed Account';
      if (!q || acctName.toLowerCase().includes(q)) {
        count++;
        $list.append(`
          <button type="button" class="account-item fade-in" data-id="${acct.id}">
            <div class="acct-avatar">${esc(getInitials(acctName))}</div>
            <div class="acct-info">
              <div class="acct-name">${esc(acctName)}</div>
            </div>
          </button>
        `);
      }
    });

    if (count === 0) {
      $list.append('<div style="padding:12px 10px;font-size:.8rem;color:var(--text-muted);">No accounts match.</div>');
    }
  }

  // Initial load
  loadData();

  // Sidebar Search
  $('#accountSearch').on('input', function () {
    renderSidebar($(this).val());
  });

  // 2. Handle Account Selection
  $('#accountList').on('click', '.account-item', function () {
    const id = $(this).data('id');
    activeAccount = MOCK_DATA.accounts.find(a => a.id === id);
    if (!activeAccount) return;

    activeLob = null;
    activePersona = null;

    // Update active class
    $('.account-item').removeClass('active');
    $(this).addClass('active');
    closeSidebar();

    // Hide empty state, show dashboard
    $('#emptyState').addClass('d-none');
    $('#dashboardContainer').removeClass('d-none');
    
    // Hide dependent sections
    $('#personaSection').addClass('d-none');
    $('#detailPanelContainer').addClass('d-none').empty();

    // Populate Hero Info
    $('#heroAvatar').text(getInitials(activeAccount.name));
    $('#accountName').text(activeAccount.name);
    $('#accountTicker').text(activeAccount.ticker || 'Enterprise');
    $('#accountRevenue').text(activeAccount.revenue || 'Revenue N/A');
    $('#accountLocation').text(activeAccount.location || 'Location N/A');
    $('#accountDesc').text(activeAccount.desc || 'No description available.');

    $('#crumbs').html(`<li class="breadcrumb-item active">${esc(activeAccount.name)}</li>`);
    
    // Render Compact LOB Cards
    const $lobCards = $('#lobCardsContainer').empty();
    const lobs = activeAccount.lobs || [];
    
    if (lobs.length === 0) {
      $lobCards.append('<div style="color:var(--text-muted);font-size:.85rem;padding:8px 0;">No Lines of Business discovered for this account.</div>');
      $('#lobCountBadge').text('(0 Divisions)');
    } else {
      $('#lobCountBadge').text(`(${lobs.length} Division${lobs.length > 1 ? 's' : ''})`);
      lobs.forEach(lob => {
        const subtitle = lob.revenue ? `Rev: ${lob.revenue}` : (lob.desc || 'Business Division');
        $lobCards.append(`
          <div class="compact-card lob-card fade-in" data-lob-id="${lob.id}">
            <div class="compact-card-avatar">📁</div>
            <div class="compact-card-body">
              <div class="compact-card-title">${esc(lob.name)}</div>
              <div class="compact-card-subtitle">${esc(subtitle)}</div>
            </div>
          </div>
        `);
      });
    }
    
    $('#lobSection').removeClass('d-none');
  });

  // 3. Handle LOB Card Selection
  $(document).on('click', '.lob-card', function () {
    $('.lob-card').removeClass('active');
    $(this).addClass('active');

    const lobId = $(this).data('lob-id');
    activeLob = activeAccount.lobs.find(l => l.id === lobId);
    if (!activeLob) return;

    activePersona = null;

    $('#crumbs').html(`
      <li class="breadcrumb-item"><a href="javascript:void(0)" class="crumb-account">${esc(activeAccount.name)}</a></li>
      <li class="breadcrumb-item active">${esc(activeLob.name)}</li>
    `);

    // Aggregate personas for this LOB
    const directPersonas = activeLob.personas || [];
    const subLobs = activeLob.subLobs || [];
    let allPersonas = [...directPersonas];
    subLobs.forEach(sub => {
      if (sub.personas && sub.personas.length) {
        allPersonas.push(...sub.personas);
      }
    });

    // Populate Persona Cards
    const $personaCards = $('#personaCardsContainer').empty();
    $('#personaSectionTitle').text(`👥 Organizational Hierarchy (${activeLob.name})`);
    $('#personaCountBadge').text(`(${allPersonas.length} contact${allPersonas.length !== 1 ? 's' : ''})`);

    if (allPersonas.length === 0) {
      $personaCards.append('<div style="color:var(--text-muted);font-size:.85rem;padding:8px 0;">No executive personas mapped for this division yet.</div>');
    } else {
      allPersonas.forEach((p, idx) => {
        const personaKey = p.key || `persona_${idx}`;
        p.key = personaKey;
        const pRaw = encodeURIComponent(JSON.stringify(p));
        $personaCards.append(`
          <div class="compact-card persona-card fade-in" data-key="${personaKey}" data-raw="${pRaw}">
            <div class="compact-card-avatar">${esc(getInitials(p.name))}</div>
            <div class="compact-card-body">
              <div class="compact-card-title">${esc(p.name)}</div>
              <div class="compact-card-subtitle">${esc(p.title || 'Executive')}</div>
            </div>
          </div>
        `);
      });
    }

    $('#personaSection').removeClass('d-none');

    // Render LOB Detail Panel
    renderLobDetailPanel(activeLob);
  });

  // 4. Handle Persona Card Selection
  $(document).on('click', '.persona-card', function () {
    $('.persona-card').removeClass('active');
    $(this).addClass('active');

    const pData = JSON.parse(decodeURIComponent($(this).attr('data-raw')));
    activePersona = pData;

    $('#crumbs').html(`
      <li class="breadcrumb-item"><a href="javascript:void(0)" class="crumb-account">${esc(activeAccount.name)}</a></li>
      <li class="breadcrumb-item"><a href="javascript:void(0)" class="crumb-lob">${esc(activeLob.name)}</a></li>
      <li class="breadcrumb-item active">${esc(activePersona.name)}</li>
    `);

    renderPersonaDetailPanel(activePersona);
  });

  // Breadcrumb navigation
  $(document).on('click', '.crumb-account', function () {
    if (!activeAccount) return;
    $('.lob-card').removeClass('active');
    activeLob = null;
    activePersona = null;
    $('#personaSection').addClass('d-none');
    $('#detailPanelContainer').addClass('d-none').empty();
    $('#crumbs').html(`<li class="breadcrumb-item active">${esc(activeAccount.name)}</li>`);
  });

  $(document).on('click', '.crumb-lob', function () {
    if (!activeLob) return;
    $(`.lob-card[data-lob-id="${activeLob.id}"]`).click();
  });

  // ─── Render Functions for Categorized Detail Panels ─────────────────────

  function renderLobDetailPanel(lob) {
    const lobKey = `lob_${lob.id}`;
    const state = getActionState(lobKey);

    const pullBtnDisabled = false;
    const validateBtnDisabled = !state.pulled;
    const dumpBtnDisabled = !state.validated;

    const subLobsHtml = (lob.subLobs && lob.subLobs.length) ? `
      <div class="detail-section">
        <div class="detail-section-heading">📑 Sub-Divisions & Groups (${lob.subLobs.length})</div>
        <div class="detail-grid">
          ${lob.subLobs.map(s => `
            <div class="detail-field">
              <div class="detail-label">Division Name</div>
              <div class="detail-val font-semibold">${esc(s.name)}</div>
              ${s.desc ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:2px;">${esc(s.desc)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const panelHtml = `
      <div class="detail-panel fade-in" data-entity-type="lob" data-key="${lobKey}">
        <div class="detail-panel-header">
          <div class="detail-panel-title-area">
            <span class="pill pill-brand detail-panel-badge">Line of Business Details</span>
            <h2 class="detail-panel-title">📁 ${esc(lob.name)}</h2>
            <p class="detail-panel-subtitle">${esc(lob.desc || lob.overview || 'Division Overview')}</p>
          </div>
          <div class="detail-panel-actions-wrapper">
            <div class="detail-panel-actions">
              <button type="button" class="panel-btn panel-btn-pull" ${pullBtnDisabled ? 'disabled' : ''}>📥 Pull</button>
              <button type="button" class="panel-btn panel-btn-validate" ${validateBtnDisabled ? 'disabled' : ''}>🔍 Validate</button>
              <button type="button" class="panel-btn panel-btn-dump" ${dumpBtnDisabled ? 'disabled' : ''}>💾 Dump</button>
            </div>
            <div class="panel-status-msg" id="panelStatusMsg">${state.message || ''}</div>
          </div>
        </div>

        <!-- Categorized Section 1: Overview & Structure -->
        <div class="detail-section">
          <div class="detail-section-heading">🏷️ Overview & Corporate Structure</div>
          <div class="detail-grid">
            <div class="detail-field span-2">
              <div class="detail-label">Division Overview</div>
              <div class="detail-val">${esc(lob.overview || lob.desc || 'No overview available.')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Relationship Type</div>
              <div class="detail-val"><span class="pill">${esc(lob.relationship_type || 'Operating Segment')}</span></div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Primary Domain</div>
              <div class="detail-val">${lob.domain ? `<a href="https://${esc(lob.domain)}" target="_blank">${esc(lob.domain)} ↗</a>` : '<span class="text-muted">Not specified</span>'}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Website URL</div>
              <div class="detail-val">${lob.website_url ? `<a href="${esc(lob.website_url)}" target="_blank">${esc(lob.website_url)} ↗</a>` : '<span class="text-muted">Not specified</span>'}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Crunchbase</div>
              <div class="detail-val">${lob.crunchbase_url ? `<a href="${esc(lob.crunchbase_url)}" target="_blank">View Profile ↗</a>` : '<span class="text-muted">Not specified</span>'}</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 2: Segment Metrics -->
        <div class="detail-section">
          <div class="detail-section-heading">📊 Segment Financials & Operations</div>
          <div class="detail-grid">
            <div class="detail-field">
              <div class="detail-label">Segment Revenue</div>
              <div class="detail-val">${esc(lob.revenue || 'Not disclosed')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Headcount / Size</div>
              <div class="detail-val">${esc(lob.headcount || 'Not disclosed')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Operating Head</div>
              <div class="detail-val">${esc(lob.operating_head || 'Executive Leadership')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Associated Personas</div>
              <div class="detail-val">${lob.personas ? lob.personas.length : 0} Identified</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 3: Intelligence Feeds -->
        <div class="detail-section">
          <div class="detail-section-heading">🌐 Intelligence Scraping & Feeds</div>
          <div class="detail-grid">
            <div class="detail-field">
              <div class="detail-label">Google News Feed</div>
              <div class="detail-val">${lob.google_news_rss_url ? `<a href="${esc(lob.google_news_rss_url)}" target="_blank">News RSS Stream ↗</a>` : '<span class="text-muted">Pending Generation</span>'}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Reddit RSS Feed</div>
              <div class="detail-val">${lob.reddit_rss_url ? `<a href="${esc(lob.reddit_rss_url)}" target="_blank">Reddit Discussions ↗</a>` : '<span class="text-muted">Pending Generation</span>'}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Google Patents</div>
              <div class="detail-val">${lob.google_patents_url ? `<a href="${esc(lob.google_patents_url)}" target="_blank">Patents Explorer ↗</a>` : '<span class="text-muted">Pending Generation</span>'}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Google Trends</div>
              <div class="detail-val">${lob.google_trends_url ? `<a href="${esc(lob.google_trends_url)}" target="_blank">Trends Analytics ↗</a>` : '<span class="text-muted">Pending Generation</span>'}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">YouTube Search</div>
              <div class="detail-val">${lob.youtube_search_url ? `<a href="${esc(lob.youtube_search_url)}" target="_blank">Interviews & Keynotes ↗</a>` : '<span class="text-muted">Pending Generation</span>'}</div>
            </div>
          </div>
        </div>

        ${subLobsHtml}
      </div>
    `;

    $('#detailPanelContainer').html(panelHtml).removeClass('d-none');
  }

  function renderPersonaDetailPanel(p) {
    const pKey = p.key || `persona_${p.id || p.name}`;
    const state = getActionState(pKey);

    const pullBtnDisabled = false;
    const validateBtnDisabled = !state.pulled;
    const dumpBtnDisabled = !state.validated;

    const skillsHtml = (p.skills && p.skills.length) ? p.skills.map(s => `<span class="data-tag">${esc(s)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">No skills mapped</span>';
    const kpisHtml = (p.target_kpis && p.target_kpis.length) ? p.target_kpis.map(k => `<span class="data-tag data-tag-success">${esc(k)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">No KPIs mapped</span>';
    const painPointsHtml = (p.operational_pain_points && p.operational_pain_points.length) ? p.operational_pain_points.map(pain => `<span class="data-tag data-tag-warning">${esc(pain)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">None recorded</span>';
    const objectionsHtml = (p.key_objections && p.key_objections.length) ? p.key_objections.map(obj => `<span class="data-tag">${esc(obj)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">None recorded</span>';

    const panelHtml = `
      <div class="detail-panel fade-in" data-entity-type="persona" data-key="${pKey}">
        <div class="detail-panel-header">
          <div class="detail-panel-title-area">
            <span class="pill pill-brand detail-panel-badge">Executive Persona Details</span>
            <h2 class="detail-panel-title">👤 ${esc(p.name)}</h2>
            <p class="detail-panel-subtitle">${esc(p.title || 'Executive')} • <span class="pill pill-success" style="font-size:.72rem;">${esc(p.tier || 'Target Tier')}</span> • ${esc(activeAccount.name)}</p>
          </div>
          <div class="detail-panel-actions-wrapper">
            <div class="detail-panel-actions">
              <button type="button" class="panel-btn panel-btn-pull" ${pullBtnDisabled ? 'disabled' : ''}>📥 Pull</button>
              <button type="button" class="panel-btn panel-btn-validate" ${validateBtnDisabled ? 'disabled' : ''}>🔍 Validate</button>
              <button type="button" class="panel-btn panel-btn-dump" ${dumpBtnDisabled ? 'disabled' : ''}>💾 Dump</button>
            </div>
            <div class="panel-status-msg" id="panelStatusMsg">${state.message || ''}</div>
          </div>
        </div>

        <!-- Categorized Section 1: Executive Profile & Demographics -->
        <div class="detail-section">
          <div class="detail-section-heading">👤 Executive Profile & Demographics</div>
          <div class="detail-grid">
            <div class="detail-field">
              <div class="detail-label">Full Name</div>
              <div class="detail-val font-semibold">${esc(p.name)}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Corporate Title</div>
              <div class="detail-val">${esc(p.title || 'Executive')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Corporate Email</div>
              <div class="detail-val">${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '<span class="text-muted">Not discovered</span>'}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Email Status / Phone</div>
              <div class="detail-val">${esc(p.email_status || 'Verified')} ${p.phone ? `• ${esc(p.phone)}` : ''}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Location / Base</div>
              <div class="detail-val">${esc(p.location || [p.city, p.state, p.country].filter(Boolean).join(', ') || 'Headquarters')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Education / Alma Mater</div>
              <div class="detail-val">${esc(p.degree ? `${p.degree} — ${p.institution || ''}` : p.institution || 'Standard Executive Profile')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Prior Company Experience</div>
              <div class="detail-val">${esc(p.prior_company || 'Corporate Enterprise')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Seniority / Hierarchy</div>
              <div class="detail-val">${esc(p.seniority || 'C-Suite / VP')} (Level ${p.hierarchy_level || 1})</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 2: Behavior & Strategic KPIs -->
        <div class="detail-section">
          <div class="detail-section-heading">🎯 Behavior & Strategic KPIs</div>
          <div class="detail-grid">
            <div class="detail-field span-2">
              <div class="detail-label">Target KPIs & Priorities</div>
              <div class="tag-list">${kpisHtml}</div>
            </div>
            <div class="detail-field span-2">
              <div class="detail-label">Core Skills & Domain Expertise</div>
              <div class="tag-list">${skillsHtml}</div>
            </div>
            <div class="detail-field span-2">
              <div class="detail-label">Operational Pain Points</div>
              <div class="tag-list">${painPointsHtml}</div>
            </div>
            <div class="detail-field span-2">
              <div class="detail-label">Anticipated Objections</div>
              <div class="tag-list">${objectionsHtml}</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 3: Personalized Messaging & Pitch -->
        <div class="detail-section">
          <div class="detail-section-heading">💬 Personalized Engagement & Messaging</div>
          <div class="detail-grid">
            <div class="detail-field span-full" style="background: rgba(99,102,241,.05); border-color: rgba(99,102,241,.2);">
              <div class="detail-label" style="color:var(--brand);">Personalized Icebreaker</div>
              <div class="detail-val" style="font-size:.9rem; color:var(--text-primary);">
                "${esc(p.personalized_icebreaker || `Congratulations on your leadership initiatives at ${activeAccount.name}.`)}"
              </div>
            </div>
            <div class="detail-field span-2">
              <div class="detail-label">Value Proposition Pitch</div>
              <div class="detail-val">${esc(p.value_proposition || 'Targeted enterprise acceleration and workflow intelligence.')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Communication Style</div>
              <div class="detail-val">${esc(p.communication_style || 'Analytical, data-driven, and outcome-oriented')}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Authority & Influence</div>
              <div class="detail-val">Decision: ${esc(p.decision_authority || 'Primary')} • Budget: ${esc(p.budget_authority || 'Sign-off')}</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 4: Online Footprint & Scraping Feeds -->
        <div class="detail-section">
          <div class="detail-section-heading">🌐 Online Footprint & Intelligence Feeds</div>
          <div class="detail-grid">
            <div class="detail-field">
              <div class="detail-label">LinkedIn Profile</div>
              <div class="detail-val">${p.linkedin_url ? `<a href="${esc(p.linkedin_url)}" target="_blank">LinkedIn ↗</a>` : `<a href="https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(p.name + ' ' + activeAccount.name)}" target="_blank">Search Profile ↗</a>`}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Twitter / X Live Stream</div>
              <div class="detail-val">${p.twitter_live_url ? `<a href="${esc(p.twitter_live_url)}" target="_blank">Live Tweets ↗</a>` : `<a href="https://x.com/search?q=${encodeURIComponent(p.name)}&f=live" target="_blank">Live Search ↗</a>`}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Google News RSS</div>
              <div class="detail-val">${p.rss_url ? `<a href="${esc(p.rss_url)}" target="_blank">News Stream ↗</a>` : `<a href="https://news.google.com/rss/search?q=${encodeURIComponent(p.name)}" target="_blank">News RSS ↗</a>`}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Patents Explorer</div>
              <div class="detail-val">${p.google_patents_url ? `<a href="${esc(p.google_patents_url)}" target="_blank">Google Patents ↗</a>` : `<a href="https://patents.google.com/?inventor=${encodeURIComponent(p.name)}" target="_blank">Patents Search ↗</a>`}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">YouTube Interviews</div>
              <div class="detail-val">${p.youtube_interviews_url ? `<a href="${esc(p.youtube_interviews_url)}" target="_blank">Keynotes & Talks ↗</a>` : `<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(p.name + ' interview')}" target="_blank">YouTube Search ↗</a>`}</div>
            </div>
            <div class="detail-field">
              <div class="detail-label">Podcasts & Media</div>
              <div class="detail-val">${p.podcast_search_url ? `<a href="${esc(p.podcast_search_url)}" target="_blank">Podcast Search ↗</a>` : `<a href="https://www.google.com/search?q=${encodeURIComponent(p.name + ' podcast')}" target="_blank">Podcasts ↗</a>`}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    $('#detailPanelContainer').html(panelHtml).removeClass('d-none');
  }

  // ─── Action Center Handlers (Sequential: Pull -> Validate -> Dump) ───────

  // Helper to ensure live data is staged
  async function fetchAndStageEntity(entityType, key, rawData) {
    if (entityType === 'persona') {
      const res = await fetch('/api/personas/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: (rawData.name || key).toLowerCase().replace(/\s+/g, '_'),
          display_name: rawData.name,
          linkedin_url: rawData.linkedin_url || null,
          account_id: activeAccount ? activeAccount.id : null,
          enrich_ai_dossier: true
        })
      });
      if (!res.ok) throw new Error('Failed to fetch persona dossier');
      const data = await res.json();
      stagedDataStore[key] = data.person;
      return data.person;
    } else {
      // For LOB
      stagedDataStore[key] = {
        key: key,
        name: rawData.name,
        account_id: activeAccount ? activeAccount.id : null,
        desc: rawData.desc
      };
      return stagedDataStore[key];
    }
  }

  // 1. Pull Button
  $(document).on('click', '.panel-btn-pull', async function () {
    const $panel = $(this).closest('.detail-panel');
    const entityType = $panel.data('entity-type');
    const key = $panel.data('key');
    const state = getActionState(key);
    const $btn = $(this);
    const $status = $panel.find('#panelStatusMsg');

    $btn.text('Pulling...').prop('disabled', true);

    try {
      const targetData = entityType === 'persona' ? activePersona : activeLob;
      await fetchAndStageEntity(entityType, key, targetData);

      state.pulled = true;
      state.message = '<span style="color:#10b981;">✔ Data pulled & staged</span>';

      $btn.text('📥 Pulled ✔').prop('disabled', false);
      $panel.find('.panel-btn-validate').prop('disabled', false);
      $status.html(state.message);
    } catch (e) {
      $btn.text('📥 Pull').prop('disabled', false);
      state.message = '<span style="color:#ef4444;">Error pulling data</span>';
      $status.html(state.message);
    }
  });

  // 2. Validate Button
  $(document).on('click', '.panel-btn-validate', async function () {
    const $panel = $(this).closest('.detail-panel');
    const entityType = $panel.data('entity-type');
    const key = $panel.data('key');
    const state = getActionState(key);
    const $btn = $(this);
    const $status = $panel.find('#panelStatusMsg');

    $btn.text('Validating...').prop('disabled', true);

    try {
      let stagedData = stagedDataStore[key];
      if (!stagedData) {
        const targetData = entityType === 'persona' ? activePersona : activeLob;
        stagedData = await fetchAndStageEntity(entityType, key, targetData);
        state.pulled = true;
      }

      const res = await fetch('/api/personas/validate-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stagedData)
      });
      const data = await res.json();

      state.validated = true;
      state.score = data.score;
      
      let msg = `<span style="color:${data.ready_for_db ? '#10b981' : '#f59e0b'};">Quality Score: ${data.score}/100</span>`;
      if (data.warnings && data.warnings.length > 0) {
        msg += ` <span style="color:#ef4444;font-size:.72rem;">(${data.warnings[0]})</span>`;
      }
      state.message = msg;

      $btn.text('🔍 Validated ✔').prop('disabled', false);
      $panel.find('.panel-btn-dump').prop('disabled', false);
      $status.html(state.message);
    } catch (e) {
      $btn.text('🔍 Validate').prop('disabled', false);
      state.message = '<span style="color:#ef4444;">Error validating data</span>';
      $status.html(state.message);
    }
  });

  // 3. Dump Button
  $(document).on('click', '.panel-btn-dump', async function () {
    const $panel = $(this).closest('.detail-panel');
    const entityType = $panel.data('entity-type');
    const key = $panel.data('key');
    const state = getActionState(key);
    const $btn = $(this);
    const $status = $panel.find('#panelStatusMsg');

    $btn.text('Dumping...').prop('disabled', true);

    try {
      const stagedData = stagedDataStore[key] || (entityType === 'persona' ? activePersona : activeLob);
      const res = await fetch('/api/personas/dump-single-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: activeAccount ? activeAccount.id : 1,
          person_data: stagedData
        })
      });
      const data = await res.json();

      if (data.status === 'success') {
        state.dumped = true;
        state.message = `<span style="color:#10b981;">✔ Saved to database</span>`;
        $btn.text('💾 Dumped ✔').prop('disabled', false);
        $status.html(state.message);
      } else {
        $btn.text('💾 Dump').prop('disabled', false);
        state.message = `<span style="color:#ef4444;">Error: ${data.message}</span>`;
        $status.html(state.message);
      }
    } catch (e) {
      $btn.text('💾 Dump').prop('disabled', false);
      state.message = '<span style="color:#ef4444;">Error dumping to database</span>';
      $status.html(state.message);
    }
  });

});
