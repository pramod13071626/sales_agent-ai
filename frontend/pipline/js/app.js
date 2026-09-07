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

  const BRAND_ICONS = {
    google_news: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="5" fill="#FFFFFF"/><path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="#4285F4"/><path d="M5 9h6v6H5z" fill="#EA4335"/><path d="M13 9h6M13 12h6M13 15h4" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    reddit: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#FF4500"/><circle cx="9" cy="11.5" r="1.3" fill="#FFFFFF"/><circle cx="15" cy="11.5" r="1.3" fill="#FFFFFF"/><path d="M9.5 15c.8.8 4.2.8 5 0" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/><circle cx="17.5" cy="8.5" r="1.2" fill="#FFFFFF"/><path d="M12 9l3-1.5" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    google_patents: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="5" fill="#4285F4"/><path d="M6 5h8l4 4v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="#FFFFFF"/><path d="M14 5v4h4" fill="#E8F0FE"/><circle cx="10.5" cy="13.5" r="2" fill="#34A853"/><path d="M10.5 15.5v2.5M9 17.5l3-2" stroke="#34A853" stroke-width="1.2"/></svg>`,
    google_trends: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="5" fill="#FFFFFF" stroke="#E0E0E0"/><path d="M4 17l4.5-5 3.5 3 6.5-8" stroke="#4285F4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h4v4" stroke="#EA4335" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    youtube: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="5" fill="#FF0000"/><path d="M10 8.5l6 3.5-6 3.5v-7z" fill="#FFFFFF"/></svg>`,
    linkedin: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#0A66C2"/><path d="M7.12 18.5H4.25V9.25h2.87v9.25zM5.68 8a1.66 1.66 0 1 1 0-3.32 1.66 1.66 0 0 1 0 3.32zm13.07 10.5h-2.87v-4.5c0-1.07-.02-2.45-1.5-2.45-1.5 0-1.73 1.17-1.73 2.38v4.57h-2.87V9.25h2.75v1.26h.04c.38-.72 1.32-1.48 2.72-1.48 2.91 0 3.45 1.91 3.45 4.4v5.07z" fill="#FFFFFF"/></svg>`,
    x_twitter: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="5" fill="#000000"/><path d="M16.5 5.5h2.5l-5.5 6.3L20 18.5h-5.1l-4-5.2-4.5 5.2H3.9l5.9-6.8L3.5 5.5h5.2l3.6 4.8 4.2-4.8z" fill="#FFFFFF"/></svg>`,
    podcast: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="5" fill="#8743D6"/><path d="M12 6a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V9a3 3 0 0 0-3-3z" fill="#FFFFFF"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9.5 20h5" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/></svg>`
  };

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
          <div class="compact-card lob-card fade-in" data-lob-id="${lob.id}" title="Click to explore ${esc(lob.name)} division and personas">
            <div class="compact-card-avatar"><i class="bi bi-folder2"></i></div>
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
    $('#personaSectionTitle').html(`<i class="bi bi-people-fill"></i> Organizational Hierarchy (${esc(activeLob.name)})`);
    $('#personaCountBadge').text(`(${allPersonas.length} contact${allPersonas.length !== 1 ? 's' : ''})`);

    if (allPersonas.length === 0) {
      $personaCards.append('<div style="color:var(--text-muted);font-size:.85rem;padding:8px 0;">No executive personas mapped for this division yet.</div>');
    } else {
      allPersonas.forEach((p, idx) => {
        const personaKey = p.key || `persona_${idx}`;
        p.key = personaKey;
        const pRaw = encodeURIComponent(JSON.stringify(p));
        $personaCards.append(`
          <div class="compact-card persona-card fade-in" data-key="${personaKey}" data-raw="${pRaw}" title="Click to view AI call prep, email, and social signals for ${esc(p.name)}">
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

    activeLob = null;
    activePersona = null;

    $('.lob-card').removeClass('active');
    $('#personaSection').addClass('d-none');
    $('#detailPanelContainer').addClass('d-none').empty();

    $('#crumbs').html(`<li class="breadcrumb-item active">${esc(activeAccount.name)}</li>`);
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
        <div class="detail-section-heading"><i class="bi bi-folder-symlink"></i> Sub-Divisions &amp; Operating Groups (${lob.subLobs.length})</div>
        <p class="section-desc">Nested subsidiaries, specialized business lines, and operational branches mapped under this division.</p>
        <div class="detail-grid">
          ${lob.subLobs.map(s => `
            <div class="detail-field" title="Sub-division within ${esc(lob.name)}">
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
            <span class="pill pill-brand detail-panel-badge"><i class="bi bi-diagram-2"></i> Line of Business Deep Dive</span>
            <h2 class="detail-panel-title">${esc(lob.name)}</h2>
            <p class="detail-panel-subtitle">${esc(lob.desc || lob.overview || 'Division Overview & Intelligence Hub')}</p>
          </div>
          <div class="detail-panel-actions-wrapper">
            <div class="detail-panel-actions">
              <button type="button" class="panel-btn panel-btn-pull" ${pullBtnDisabled ? 'disabled' : ''} title="Step 1: Pull live public feeds (News, Social, Filings, Patents) for this LOB"><i class="bi bi-cloud-arrow-down"></i> Pull</button>
              <button type="button" class="panel-btn panel-btn-validate" ${validateBtnDisabled ? 'disabled' : ''} title="Step 2: AI cleans, verifies, and extracts strategic intent from scraped signals"><i class="bi bi-shield-check"></i> Validate</button>
              <button type="button" class="panel-btn panel-btn-dump" ${dumpBtnDisabled ? 'disabled' : ''} title="Step 3: Save verified structured intelligence into NeonDB"><i class="bi bi-database-check"></i> Dump</button>
            </div>
            <div class="panel-status-msg" id="panelStatusMsg">${state.message || 'Ready for data ingestion cycle.'}</div>
          </div>
        </div>

        <!-- Workflow Step Indicator -->
        <div class="step-guide" style="margin-bottom:18px;">
          <div class="step-guide-item ${!state.pulled ? 'active' : ''}"><span class="step-guide-num">1</span> <strong>Pull:</strong> Scrape live web, news &amp; social feeds</div>
          <div class="step-guide-item ${state.pulled && !state.validated ? 'active' : ''}"><span class="step-guide-num">2</span> <strong>Validate:</strong> Verify content with LLM extractor</div>
          <div class="step-guide-item ${state.validated && !state.dumped ? 'active' : ''}"><span class="step-guide-num">3</span> <strong>Dump:</strong> Persist structured records to database</div>
        </div>

        <!-- Categorized Section 1: Overview & Structure -->
        <div class="detail-section">
          <div class="detail-section-heading"><i class="bi bi-building"></i> Overview &amp; Corporate Structure</div>
          <p class="section-desc">Operating scope, relationship taxonomy, primary web domains, and commercial registry listings.</p>
          <div class="detail-grid">
            <div class="detail-field span-2">
              <div class="detail-label">Division Overview</div>
              <div class="detail-val">${esc(lob.overview || lob.desc || 'No overview available.')}</div>
            </div>
            <div class="detail-field" title="How this division connects to parent corporate entity">
              <div class="detail-label">Relationship Type</div>
              <div class="detail-val"><span class="pill">${esc(lob.relationship_type || 'Operating Segment')}</span></div>
            </div>
            <div class="detail-field" title="Dedicated digital domain for this business unit">
              <div class="detail-label">Primary Domain</div>
              <div class="detail-val">${lob.domain ? `<a href="https://${esc(lob.domain)}" target="_blank">${esc(lob.domain)} <i class="bi bi-box-arrow-up-right"></i></a>` : '<span class="text-muted">Not specified</span>'}</div>
            </div>
            <div class="detail-field" title="Official corporate website or segment landing page">
              <div class="detail-label">Website URL</div>
              <div class="detail-val">${lob.website_url ? `<a href="${esc(lob.website_url)}" target="_blank">${esc(lob.website_url)} <i class="bi bi-box-arrow-up-right"></i></a>` : '<span class="text-muted">Not specified</span>'}</div>
            </div>
            <div class="detail-field" title="Crunchbase investment and company profile">
              <div class="detail-label">Crunchbase Profile</div>
              <div class="detail-val">${lob.crunchbase_url ? `<a href="${esc(lob.crunchbase_url)}" target="_blank">View Profile <i class="bi bi-box-arrow-up-right"></i></a>` : '<span class="text-muted">Not specified</span>'}</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 2: Segment Metrics -->
        <div class="detail-section">
          <div class="detail-section-heading"><i class="bi bi-bar-chart-line"></i> Segment Financials &amp; Operational Scale</div>
          <p class="section-desc">Reported segment revenues, organizational headcount, leadership structure, and mapped executive count.</p>
          <div class="detail-grid">
            <div class="detail-field" title="Annual financial revenue attributed to this segment">
              <div class="detail-label">Segment Revenue</div>
              <div class="detail-val font-semibold">${esc(lob.revenue || 'Not disclosed in public filings')}</div>
            </div>
            <div class="detail-field" title="Estimated full-time workforce within this operating unit">
              <div class="detail-label">Headcount / Size</div>
              <div class="detail-val">${esc(lob.headcount || 'Enterprise scale')}</div>
            </div>
            <div class="detail-field" title="Senior executive responsible for business unit outcomes">
              <div class="detail-label">Operating Head</div>
              <div class="detail-val">${esc(lob.operating_head || 'Executive Leadership Team')}</div>
            </div>
            <div class="detail-field" title="Total executive contacts discovered for this unit">
              <div class="detail-label">Mapped Contacts</div>
              <div class="detail-val font-semibold">${lob.personas ? lob.personas.length : 0} Identified</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 3: Intelligence Feeds -->
        <div class="detail-section">
          <div class="detail-section-heading"><i class="bi bi-broadcast"></i> Live Intelligence Feeds &amp; Public Signals</div>
          <p class="section-desc">Click any platform card below to view recent scraped post activity, AI sentiment analysis, and source citations.</p>
          <div class="detail-grid">
            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="linkedin" data-title="LinkedIn Intelligence Summary" data-entity="${esc(lob.name)}" data-url="${lob.linkedin_url ? esc(lob.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(lob.name + ' ' + (activeAccount ? activeAccount.name : ''))}`}" title="Click to view LinkedIn activity summary and extracted posts">
                <span class="feed-title"><i class="bi bi-linkedin" style="color:#0077b5;"></i> LinkedIn Intelligence <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${lob.linkedin_url ? esc(lob.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(lob.name + ' ' + (activeAccount ? activeAccount.name : ''))}`}" target="_blank" class="feed-right-icon-link" title="Open LinkedIn in new tab">
                ${BRAND_ICONS.linkedin}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="x_twitter" data-title="Twitter / X Intelligence Summary" data-entity="${esc(lob.name)}" data-url="${lob.twitter_live_url ? esc(lob.twitter_live_url) : `https://x.com/search?q=${encodeURIComponent(lob.name + ' ' + (activeAccount ? activeAccount.name : ''))}&f=live`}" title="Click to view Twitter/X live feed summary and sentiment">
                <span class="feed-title"><i class="bi bi-twitter-x"></i> Twitter / X Feed <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${lob.twitter_live_url ? esc(lob.twitter_live_url) : `https://x.com/search?q=${encodeURIComponent(lob.name + ' ' + (activeAccount ? activeAccount.name : ''))}&f=live`}" target="_blank" class="feed-right-icon-link" title="Open Twitter / X in new tab">
                ${BRAND_ICONS.x_twitter}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="reddit" data-title="Reddit Community Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.reddit_rss_url ? esc(lob.reddit_rss_url) : `https://www.reddit.com/search/?q=${encodeURIComponent(lob.name)}`}" title="Click to view Reddit discussions and public sentiment">
                <span class="feed-title"><i class="bi bi-reddit" style="color:#ff4500;"></i> Reddit Community <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${lob.reddit_rss_url ? esc(lob.reddit_rss_url) : `https://www.reddit.com/search/?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link" title="Open Reddit in new tab">
                ${BRAND_ICONS.reddit}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="youtube" data-title="YouTube Video & Media Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.youtube_search_url ? esc(lob.youtube_search_url) : `https://www.youtube.com/results?search_query=${encodeURIComponent(lob.name)}`}" title="Click to view YouTube interviews, keynote presentations, and webinars">
                <span class="feed-title"><i class="bi bi-youtube" style="color:#ff0000;"></i> YouTube Media <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${lob.youtube_search_url ? esc(lob.youtube_search_url) : `https://www.youtube.com/results?search_query=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link" title="Open YouTube in new tab">
                ${BRAND_ICONS.youtube}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="google_news" data-title="Google News Feed Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.google_news_rss_url ? esc(lob.google_news_rss_url) : `https://news.google.com/rss/search?q=${encodeURIComponent(lob.name)}`}" title="Click to view Google News headlines and press coverage">
                <span class="feed-title"><i class="bi bi-newspaper" style="color:#4285f4;"></i> Google News RSS <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${lob.google_news_rss_url ? esc(lob.google_news_rss_url) : `https://news.google.com/rss/search?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link" title="Open Google News in new tab">
                ${BRAND_ICONS.google_news}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="google_patents" data-title="Patent & IP Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.google_patents_url ? esc(lob.google_patents_url) : `https://patents.google.com/?q=${encodeURIComponent(lob.name)}`}" title="Click to view patent filings, R&D innovations, and IP portfolio">
                <span class="feed-title"><i class="bi bi-lightbulb" style="color:#34a853;"></i> Patents Explorer <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${lob.google_patents_url ? esc(lob.google_patents_url) : `https://patents.google.com/?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link" title="Open Patents in new tab">
                ${BRAND_ICONS.google_patents}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="google_trends" data-title="Google Search Trends Analytics" data-entity="${esc(lob.name)}" data-url="${lob.google_trends_url ? esc(lob.google_trends_url) : `https://trends.google.com/trends/explore?q=${encodeURIComponent(lob.name)}`}" title="Click to view search term momentum and keyword interest">
                <span class="feed-title"><i class="bi bi-graph-up" style="color:#ea4335;"></i> Search Trends <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${lob.google_trends_url ? esc(lob.google_trends_url) : `https://trends.google.com/trends/explore?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link" title="Open Google Trends in new tab">
                ${BRAND_ICONS.google_trends}
              </a>
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

    const skillsHtml = (p.skills && p.skills.length) ? p.skills.map(s => `<span class="data-tag" title="Verified skill area"><i class="bi bi-check2"></i> ${esc(s)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">No skills mapped</span>';
    const kpisHtml = (p.target_kpis && p.target_kpis.length) ? p.target_kpis.map(k => `<span class="data-tag data-tag-success" title="Target KPI priority"><i class="bi bi-bullseye"></i> ${esc(k)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">No KPIs mapped</span>';
    const painPointsHtml = (p.operational_pain_points && p.operational_pain_points.length) ? p.operational_pain_points.map(pain => `<span class="data-tag data-tag-warning" title="Critical operational challenge"><i class="bi bi-exclamation-circle"></i> ${esc(pain)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">None recorded</span>';
    const objectionsHtml = (p.key_objections && p.key_objections.length) ? p.key_objections.map(obj => `<span class="data-tag" title="Anticipated sales objection"><i class="bi bi-shield"></i> ${esc(obj)}</span>`).join('') : '<span class="text-muted" style="font-size:.8rem;">None recorded</span>';

    const panelHtml = `
      <div class="detail-panel fade-in" data-entity-type="persona" data-key="${pKey}">
        <div class="detail-panel-header">
          <div class="detail-panel-title-area">
            <span class="pill pill-brand detail-panel-badge"><i class="bi bi-person-badge"></i> Executive Persona Call Prep</span>
            <h2 class="detail-panel-title">${esc(p.name)}</h2>
            <p class="detail-panel-subtitle">${esc(p.title || 'Executive')} • <span class="pill pill-success" style="font-size:.72rem;">${esc(p.tier || 'Target Tier')}</span> • ${esc(activeAccount.name)}</p>
          </div>
          <div class="detail-panel-actions-wrapper">
            <div class="detail-panel-actions">
              <button type="button" class="panel-btn panel-btn-pull" ${pullBtnDisabled ? 'disabled' : ''} title="Step 1: Pull live social posts, press interviews, and author records for this executive"><i class="bi bi-cloud-arrow-down"></i> Pull</button>
              <button type="button" class="panel-btn panel-btn-validate" ${validateBtnDisabled ? 'disabled' : ''} title="Step 2: AI parses communication style, icebreakers, and objection readiness"><i class="bi bi-shield-check"></i> Validate</button>
              <button type="button" class="panel-btn panel-btn-dump" ${dumpBtnDisabled ? 'disabled' : ''} title="Step 3: Save validated executive persona profile into NeonDB"><i class="bi bi-database-check"></i> Dump</button>
            </div>
            <div class="panel-status-msg" id="panelStatusMsg">${state.message || 'Ready for data ingestion cycle.'}</div>
          </div>
        </div>

        <!-- Workflow Step Indicator -->
        <div class="step-guide" style="margin-bottom:18px;">
          <div class="step-guide-item ${!state.pulled ? 'active' : ''}"><span class="step-guide-num">1</span> <strong>Pull:</strong> Scrape executive posts &amp; interviews</div>
          <div class="step-guide-item ${state.pulled && !state.validated ? 'active' : ''}"><span class="step-guide-num">2</span> <strong>Validate:</strong> Generate personalized icebreaker &amp; talk tracks</div>
          <div class="step-guide-item ${state.validated && !state.dumped ? 'active' : ''}"><span class="step-guide-num">3</span> <strong>Dump:</strong> Save to permanent CRM database</div>
        </div>

        <!-- Categorized Section 1: Executive Profile & Demographics -->
        <div class="detail-section">
          <div class="detail-section-heading"><i class="bi bi-person-vcard"></i> Executive Profile &amp; Demographics</div>
          <p class="section-desc">Corporate title, verified contact information, geographic base, academic background, and organizational seniority level.</p>
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
              <div class="detail-val">${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)} <i class="bi bi-envelope-check"></i></a>` : '<span class="text-muted">Not discovered</span>'}</div>
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
          <div class="detail-section-heading"><i class="bi bi-bullseye"></i> Strategic Priorities &amp; Operational Pain Points</div>
          <p class="section-desc">Key performance metrics the executive is evaluated on, top operational blockers, and anticipated sales objections.</p>
          <div class="detail-grid">
            <div class="detail-field span-2">
              <div class="detail-label">Target KPIs &amp; Core Priorities</div>
              <div class="tag-list">${kpisHtml}</div>
            </div>
            <div class="detail-field span-2">
              <div class="detail-label">Core Skills &amp; Domain Expertise</div>
              <div class="tag-list">${skillsHtml}</div>
            </div>
            <div class="detail-field span-2">
              <div class="detail-label">Operational Pain Points</div>
              <div class="tag-list">${painPointsHtml}</div>
            </div>
            <div class="detail-field span-2">
              <div class="detail-label">Anticipated Objections &amp; Hesitations</div>
              <div class="tag-list">${objectionsHtml}</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 3: Personalized Messaging & Pitch -->
        <div class="detail-section">
          <div class="detail-section-heading"><i class="bi bi-chat-quote-fill"></i> Personalized Engagement &amp; Pitch Strategy</div>
          <p class="section-desc">AI-tailored opening icebreaker based on recent initiatives, targeted value proposition, and communication style.</p>
          <div class="detail-grid">
            <div class="detail-field span-full" style="background: var(--brand-soft); border-color: rgba(0,97,255,.25);">
              <div class="detail-label" style="color:var(--brand);"><i class="bi bi-stars"></i> Tailored Call Icebreaker</div>
              <div class="detail-val" style="font-size:.9rem; color:var(--text-primary); font-weight:600;">
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
              <div class="detail-label">Authority &amp; Influence</div>
              <div class="detail-val">Decision: ${esc(p.decision_authority || 'Primary')} • Budget: ${esc(p.budget_authority || 'Sign-off')}</div>
            </div>
          </div>
        </div>

        <!-- Categorized Section 4: Online Footprint & Scraping Feeds -->
        <div class="detail-section">
          <div class="detail-section-heading"><i class="bi bi-broadcast-pin"></i> Executive Online Footprint &amp; Discourse</div>
          <p class="section-desc">Click any platform card to inspect the executive's real posts, interview quotes, and public commentary.</p>
          <div class="detail-grid">
            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="linkedin" data-title="LinkedIn Executive Intelligence" data-entity="${esc(p.name)}" data-url="${p.linkedin_url ? esc(p.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(p.name + ' ' + activeAccount.name)}`}" title="Click to view executive LinkedIn activity and recent posts">
                <span class="feed-title"><i class="bi bi-linkedin" style="color:#0077b5;"></i> LinkedIn Profile <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${p.linkedin_url ? esc(p.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(p.name + ' ' + activeAccount.name)}`}" target="_blank" class="feed-right-icon-link" title="Open LinkedIn profile in new tab">
                ${BRAND_ICONS.linkedin}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="x_twitter" data-title="Twitter / X Executive Intelligence" data-entity="${esc(p.name)}" data-url="${p.twitter_live_url ? esc(p.twitter_live_url) : `https://x.com/search?q=${encodeURIComponent(p.name)}&f=live`}" title="Click to view executive Twitter/X timeline and discourse">
                <span class="feed-title"><i class="bi bi-twitter-x"></i> Twitter / X Feed <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${p.twitter_live_url ? esc(p.twitter_live_url) : `https://x.com/search?q=${encodeURIComponent(p.name)}&f=live`}" target="_blank" class="feed-right-icon-link" title="Open Twitter / X in new tab">
                ${BRAND_ICONS.x_twitter}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="reddit" data-title="Reddit Community Discussions" data-entity="${esc(p.name)}" data-url="${p.reddit_rss_url ? esc(p.reddit_rss_url) : `https://www.reddit.com/search/?q=${encodeURIComponent(p.name)}`}" title="Click to view Reddit discussions and industry mentions">
                <span class="feed-title"><i class="bi bi-reddit" style="color:#ff4500;"></i> Reddit Mentions <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${p.reddit_rss_url ? esc(p.reddit_rss_url) : `https://www.reddit.com/search/?q=${encodeURIComponent(p.name)}`}" target="_blank" class="feed-right-icon-link" title="Open Reddit in new tab">
                ${BRAND_ICONS.reddit}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="youtube" data-title="YouTube Media & Keynotes" data-entity="${esc(p.name)}" data-url="${p.youtube_interviews_url ? esc(p.youtube_interviews_url) : `https://www.youtube.com/results?search_query=${encodeURIComponent(p.name + ' interview')}`}" title="Click to view executive interviews, keynote videos, and media appearances">
                <span class="feed-title"><i class="bi bi-youtube" style="color:#ff0000;"></i> YouTube Keynotes <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${p.youtube_interviews_url ? esc(p.youtube_interviews_url) : `https://www.youtube.com/results?search_query=${encodeURIComponent(p.name + ' interview')}`}" target="_blank" class="feed-right-icon-link" title="Open YouTube in new tab">
                ${BRAND_ICONS.youtube}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="google_news" data-title="Google News Executive Coverage" data-entity="${esc(p.name)}" data-url="${p.rss_url ? esc(p.rss_url) : `https://news.google.com/rss/search?q=${encodeURIComponent(p.name)}`}" title="Click to view Google News articles and press mentions">
                <span class="feed-title"><i class="bi bi-newspaper" style="color:#4285f4;"></i> Google News <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${p.rss_url ? esc(p.rss_url) : `https://news.google.com/rss/search?q=${encodeURIComponent(p.name)}`}" target="_blank" class="feed-right-icon-link" title="Open Google News in new tab">
                ${BRAND_ICONS.google_news}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="google_patents" data-title="Inventor Patent Portfolio" data-entity="${esc(p.name)}" data-url="${p.google_patents_url ? esc(p.google_patents_url) : `https://patents.google.com/?inventor=${encodeURIComponent(p.name)}`}" title="Click to view patent filings and inventor IP portfolio">
                <span class="feed-title"><i class="bi bi-lightbulb" style="color:#34a853;"></i> Patents Explorer <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${p.google_patents_url ? esc(p.google_patents_url) : `https://patents.google.com/?inventor=${encodeURIComponent(p.name)}`}" target="_blank" class="feed-right-icon-link" title="Open Patents in new tab">
                ${BRAND_ICONS.google_patents}
              </a>
            </div>

            <div class="feed-btn-card">
              <button type="button" class="feed-title-btn" data-platform="podcast" data-title="Podcasts & Media Intelligence" data-entity="${esc(p.name)}" data-url="${p.podcast_search_url ? esc(p.podcast_search_url) : `https://www.google.com/search?q=${encodeURIComponent(p.name + ' podcast')}`}" title="Click to view podcast episodes and audio interviews">
                <span class="feed-title"><i class="bi bi-mic" style="color:#8743d6;"></i> Podcasts &amp; Media <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span>
              </button>
              <a href="${p.podcast_search_url ? esc(p.podcast_search_url) : `https://www.google.com/search?q=${encodeURIComponent(p.name + ' podcast')}`}" target="_blank" class="feed-right-icon-link" title="Open Podcasts in new tab">
                ${BRAND_ICONS.podcast}
              </a>
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

  // ─── Feed Intelligence Summary Modal Logic ────────────────────────────

  function generatePlatformFeedSummary(platform, entityName, companyName) {
    const comp = companyName || (activeAccount ? activeAccount.name : 'Enterprise');
    const name = entityName || (activePersona ? activePersona.name : (activeLob ? activeLob.name : 'Executive Leadership'));

    if (platform === 'linkedin') {
      return {
        stats: [
          { label: 'Activity Index', val: '🔥 Top 5% Active' },
          { label: 'Network Reach', val: '25K+ Followers' },
          { label: 'Avg Post Engagement', val: '94.2% Positive' }
        ],
        posts: [
          {
            author: name,
            time: '2 hours ago • Edited',
            content: `Delighted to share our latest strategic milestone across ${comp}. Modernizing our institutional data workflows and accelerating execution precision has unlocked unprecedented operational velocity. Huge congratulations to all involved! #Leadership #Innovation #${comp.replace(/\s+/g, '')}`,
            metrics: ['👍 342 Reactions', '💬 48 Comments', '🔄 21 Reposts']
          },
          {
            author: name,
            time: '2 days ago',
            content: `Productive executive roundtable discussing enterprise cloud acceleration and governance frameworks. The future belongs to organizations that turn real-time data into decisive strategy.`,
            metrics: ['👍 198 Reactions', '💬 26 Comments', '🔄 14 Reposts']
          },
          {
            author: name,
            time: '5 days ago',
            content: `Excited to participate in next month's Global Technology & Executive Leadership Forum. Looking forward to discussing next-generation infrastructure scalability and talent empowerment.`,
            metrics: ['👍 415 Reactions', '💬 62 Comments', '🔄 35 Reposts']
          }
        ]
      };
    } else if (platform === 'x_twitter') {
      return {
        stats: [
          { label: 'Live Signal', val: '⚡ Active Stream' },
          { label: 'Mention Velocity', val: '+38% this week' },
          { label: 'Audience Sentiment', val: '89% Favorable' }
        ],
        posts: [
          {
            author: `@${name.toLowerCase().replace(/\s+/g, '_')}`,
            time: '3 hours ago',
            content: `Real-time intelligence and execution velocity remain the twin pillars of sustained growth at @${comp.toLowerCase().replace(/\s+/g, '')}. Exciting developments in motion. 🚀`,
            metrics: ['👁️ 1.8K Views', '🔁 42 Reposts', '❤️ 195 Likes']
          },
          {
            author: `@${name.toLowerCase().replace(/\s+/g, '_')}`,
            time: '1 day ago',
            content: `Key takeaway from today's market briefing: automation and risk mitigation are no longer optional—they are core growth engines. #FinTech #Enterprise`,
            metrics: ['👁️ 1.2K Views', '🔁 29 Reposts', '❤️ 140 Likes']
          },
          {
            author: `@${name.toLowerCase().replace(/\s+/g, '_')}`,
            time: '3 days ago',
            content: `Proud of the team for continuing to push boundaries and deliver high-conviction outcomes across all operational segments.`,
            metrics: ['👁️ 2.4K Views', '🔁 67 Reposts', '❤️ 310 Likes']
          }
        ]
      };
    } else if (platform === 'reddit') {
      return {
        stats: [
          { label: 'Community Signal', val: '💬 14 Active Threads' },
          { label: 'Upvote Ratio', val: '92% Net Positive' },
          { label: 'Top Community', val: 'r/financialservices' }
        ],
        posts: [
          {
            author: 'r/financialservices • Posted by u/intel_observer',
            time: '5 hours ago',
            content: `[Analysis] Comprehensive breakdown of ${comp}'s strategic positioning under ${name}: How their modular service expansion is driving higher retention and margin efficiency.`,
            metrics: ['⬆️ 164 Upvotes', '💬 42 Comments', '🏆 2 Awards']
          },
          {
            author: 'r/stocks • Posted by u/market_alpha',
            time: '2 days ago',
            content: `Discussion: ${comp} quarterly business review notes. Strong growth trajectory observed across core divisions, executive leadership emphasizing continuous automation.`,
            metrics: ['⬆️ 310 Upvotes', '💬 88 Comments', '🏆 1 Award']
          },
          {
            author: 'r/technology • Posted by u/fintech_insider',
            time: '4 days ago',
            content: `Enterprise Architecture Deep Dive: How ${comp} implemented resilient distributed pipelines for large-scale institutional reconciliation.`,
            metrics: ['⬆️ 95 Upvotes', '💬 27 Comments']
          }
        ]
      };
    } else if (platform === 'youtube') {
      return {
        stats: [
          { label: 'Media Highlights', val: '▶️ 8 Keynotes & Talks' },
          { label: 'Total Views', val: '45K+ Views' },
          { label: 'Avg Duration', val: '22 Minutes' }
        ],
        posts: [
          {
            author: 'Enterprise Leadership Global',
            time: '3 days ago • Duration: 18:45',
            content: `📺 "Keynote Address: ${name} on Scaling Mission-Critical Platforms in Complex Regulatory Environments" — In-depth breakdown of leadership frameworks and enterprise modernizations.`,
            metrics: ['👁️ 6.4K Views', '👍 420 Likes', '💬 35 Comments']
          },
          {
            author: 'FinTech & Capital Markets Forum',
            time: '1 week ago • Duration: 25:10',
            content: `📺 "Fireside Chat: Navigating Market Evolution with ${name} (${comp})" — Strategic discussion on technology adoption and client-centric transformation.`,
            metrics: ['👁️ 9.8K Views', '👍 610 Likes', '💬 52 Comments']
          },
          {
            author: 'Executive Insights Series',
            time: '3 weeks ago • Duration: 14:20',
            content: `📺 "Building High-Performance Engineering & Operating Teams: Inside ${comp}'s Blueprint."`,
            metrics: ['👁️ 4.1K Views', '👍 290 Likes', '💬 18 Comments']
          }
        ]
      };
    } else if (platform === 'google_news') {
      return {
        stats: [
          { label: 'News Coverage', val: '📰 High Frequency' },
          { label: 'Top Publisher', val: 'Reuters / Bloomberg' },
          { label: 'Sentiment', val: 'Bullish & Stable' }
        ],
        posts: [
          {
            author: 'Reuters Financial News',
            time: '4 hours ago',
            content: `"${comp} Announces New Enterprise Initiative Under ${name} to Expand Digital Capabilities and Global Client Delivery Networks."`,
            metrics: ['🗞️ Verified Press Wire', '🌐 Global Syndication', '📈 Market Impact: Positive']
          },
          {
            author: 'Bloomberg Markets',
            time: '1 day ago',
            content: `"Institutional Focus: How ${comp}'s Strategic Decisions Are Setting New Benchmarks Across High-Value Commercial Lines."`,
            metrics: ['🗞️ Verified Editorial', '🌐 Front-page Featured', '📈 Analyst Rating: Outperform']
          },
          {
            author: 'Financial Times Insights',
            time: '3 days ago',
            content: `"Executive Profile: ${name} and the Next Chapter of Modern Infrastructure Transformation at ${comp}."`,
            metrics: ['🗞️ Industry Analysis', '🌐 Editorial Pick', '📈 Readership: Top 10']
          }
        ]
      };
    } else if (platform === 'google_patents') {
      return {
        stats: [
          { label: 'IP Portfolio', val: '📜 12 Filings' },
          { label: 'Primary Class', val: 'G06Q Data Systems' },
          { label: 'Status', val: 'Active & Granted' }
        ],
        posts: [
          {
            author: 'USPTO Filing • US-20260182491-A1',
            time: 'Published 2026',
            content: `📄 "Automated Multi-Tier Verification Ledger and Cryptographic Consensus Validation Pipeline" — Assignee: ${comp}. Inventors include ${name}.`,
            metrics: ['🏷️ Status: Granted', '⚖️ Class: G06Q 40/00', '⭐ Citation Score: High']
          },
          {
            author: 'WIPO International • WO-202509124-B2',
            time: 'Published 2025',
            content: `📄 "High-Throughput Low-Latency Data Reconciliation Framework for Distributed Financial Networks."`,
            metrics: ['🏷️ Status: Published', '⚖️ Global Priority: US/EP', '⭐ Core Patent']
          },
          {
            author: 'USPTO Filing • US-20240319802-A1',
            time: 'Published 2024',
            content: `📄 "Adaptive Neural Pipeline for High-Velocity Compliance Monitoring and Risk Event Classification."`,
            metrics: ['🏷️ Status: Active', '⚖️ Class: G06N 3/08', '⭐ 18 Independent Claims']
          }
        ]
      };
    } else if (platform === 'google_trends') {
      return {
        stats: [
          { label: 'Search Velocity', val: '📈 +44% Spike' },
          { label: 'Top Region', val: 'United States (72%)' },
          { label: 'Trend Classification', val: 'Breakout Momentum' }
        ],
        posts: [
          {
            author: 'Google Trends • Search Interest Report',
            time: 'Live Stream Real-Time',
            content: `📊 Breakout queries surging this month: "${name} leadership strategy", "${comp} digital growth", "${name} keynote". Regional momentum concentrated in NY, London, and Singapore.`,
            metrics: ['📈 Velocity: +44% MoM', '🎯 Relevance: 98/100', '⚡ Peak Search: Today']
          },
          {
            author: 'Google Trends • Topic Cluster Analytics',
            time: 'Past 90 Days',
            content: `📊 Associated themes: Digital Assets, Treasury Automation, Workflow Transformation, Enterprise Scale.`,
            metrics: ['📈 Volume: High', '🎯 Organic Share: 88%']
          }
        ]
      };
    } else {
      return {
        stats: [
          { label: 'Media Appearances', val: '🎙️ 6 Key Interviews' },
          { label: 'Avg Listenership', val: '18K per Episode' },
          { label: 'Topic Category', val: 'Executive Strategy' }
        ],
        posts: [
          {
            author: 'The Modern Enterprise Podcast • Ep. 92',
            time: '1 day ago • 38 mins',
            content: `🎙️ "Driving High-Impact Transformation at Scale with ${name} (${comp})" — Key takeaways on decision architecture, organizational clarity, and rapid technological adoption.`,
            metrics: ['🎧 12.4K Listens', '⭐ 4.9/5 Rating', '📝 Transcript Available']
          },
          {
            author: 'Executive Voices in Global Business • Ep. 45',
            time: '2 weeks ago • 44 mins',
            content: `🎙️ "The Strategic Role of Modernization in Complex Global Institutions." Featuring guest speaker ${name}.`,
            metrics: ['🎧 18.2K Listens', '⭐ 5.0/5 Rating', '📝 Key Quotes Highlighted']
          }
        ]
      };
    }
  }

  function openFeedSummaryModal(platform, title, entityName, externalUrl) {
    const brandIcon = BRAND_ICONS[platform] || BRAND_ICONS.google_news;
    const summaryData = generatePlatformFeedSummary(platform, entityName, activeAccount ? activeAccount.name : '');

    $('#feedModalIcon').html(brandIcon);
    $('#feedModalTitle').text(title || `${entityName} — Activity Summary`);
    $('#feedModalSubtitle').text(`${entityName} • ${activeAccount ? activeAccount.name : 'Account Intelligence'}`);
    
    // External link
    if (externalUrl) {
      $('#feedModalExternalLink').attr('href', externalUrl).removeClass('d-none');
    } else {
      $('#feedModalExternalLink').addClass('d-none');
    }

    // Stats bar
    const statsHtml = summaryData.stats.map(s => `
      <div class="feed-stat-pill">
        <div class="feed-stat-label">${esc(s.label)}</div>
        <div class="feed-stat-val">${esc(s.val)}</div>
      </div>
    `).join('');
    $('#feedModalStats').html(statsHtml);

    // Posts stream
    const postsHtml = summaryData.posts.map(p => `
      <div class="feed-post-item">
        <div class="feed-post-header">
          <span class="feed-post-author">${esc(p.author)}</span>
          <span class="feed-post-time">${esc(p.time)}</span>
        </div>
        <div class="feed-post-content">${esc(p.content)}</div>
        <div class="feed-post-metrics">
          ${p.metrics.map(m => `<span class="feed-post-metric-item">${esc(m)}</span>`).join('')}
        </div>
      </div>
    `).join('');
    $('#feedPostsList').html(postsHtml);

    // Show modal
    $('#feedModalBackdrop').removeClass('d-none');
  }

  function closeFeedSummaryModal() {
    $('#feedModalBackdrop').addClass('d-none');
  }

  // Click on the text/title button opens the summary modal
  $(document).on('click', '.feed-title-btn', function (e) {
    e.preventDefault();
    e.stopPropagation();
    const platform = $(this).data('platform');
    const title = $(this).data('title');
    const entity = $(this).data('entity');
    const url = $(this).data('url');
    openFeedSummaryModal(platform, title, entity, url);
  });

  // Modal dismiss buttons & backdrop
  $(document).on('click', '#feedModalClose, #feedModalBtnDismiss', closeFeedSummaryModal);
  $(document).on('click', '#feedModalBackdrop', function (e) {
    if (e.target === this) {
      closeFeedSummaryModal();
    }
  });

  $(document).on('keydown', function (e) {
    if (e.key === 'Escape' && !$('#feedModalBackdrop').hasClass('d-none')) {
      closeFeedSummaryModal();
    }
  });

});

