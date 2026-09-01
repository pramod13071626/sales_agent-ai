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
      MOCK_DATA = Array.isArray(data) ? { accounts: data } : (data && data.accounts ? data : { accounts: data ? [data] : [] });
      renderSidebar();
      if (MOCK_DATA.accounts && MOCK_DATA.accounts.length > 0) {
        setTimeout(() => {
          $('#accountList .account-item').first().click();
        }, 50);
      }
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

  function renderAccountDataSection(account) {
    if (!account) return '';

    const sections = [
      { id: 'acct_identity', icon: 'bi-info-circle', label: 'Corporate Identity', fields: () => `
        ${renderField('Display Name', account.display_name || account.name)}
        ${renderField('Legal Name', account.legal_name)}
        ${renderField('Key', account.key)}
        ${renderField('Domain', account.domain)}
        ${renderField('Primary Domain', account.primary_domain)}
        ${renderField('Website', account.website_url, { url: true })}
        ${renderField('Crunchbase', account.crunchbase_url, { url: true })}
        ${renderField('Operating Status', account.operating_status)}
        ${renderField('Company Type', account.company_type)}
        ${renderField('Founded Year', account.founded_year)}
        ${renderField('Employees', account.employee_count_range)}
      `},
      { id: 'acct_location', icon: 'bi-geo-alt', label: 'Location & Contact', fields: () => `
        ${renderField('Headquarters', account.headquarters_location)}
        ${renderField('City', account.city)}
        ${renderField('State', account.state)}
        ${renderField('Country', account.country)}
        ${renderField('Postal Code', account.postal_code)}
        ${renderField('Phone', account.phone_number)}
        ${renderField('Sanitized Phone', account.sanitized_phone)}
        ${renderField('Contact Email', account.contact_email)}
      `},
      { id: 'acct_social', icon: 'bi-globe', label: 'Social Profiles', fields: () => `
        ${renderField('LinkedIn', account.linkedin_url, { url: true })}
        ${renderField('Twitter', account.twitter_url, { url: true })}
        ${renderField('Twitter Handle', account.twitter_handle)}
        ${renderField('GitHub', account.github_url, { url: true })}
        ${renderField('Glassdoor', account.glassdoor_url, { url: true })}
        ${renderField('Blog', account.blog_url, { url: true })}
      `},
      { id: 'acct_finance', icon: 'bi-cash-stack', label: 'Financials & Funding', fields: () => `
        ${renderField('Revenue', account.revenue || account.estimated_revenue_range)}
        ${renderField('Total Funding (USD)', account.total_funding_amount_usd)}
        ${renderField('Funding Currency', account.total_funding_currency)}
        ${renderField('Last Funding Type', account.last_funding_type)}
        ${renderField('Last Funding Date', account.last_funding_date)}
        ${renderField('Funding Rounds', account.num_funding_rounds)}
        ${renderField('Funding Status', account.funding_status)}
        ${renderField('Stock Symbol', account.stock_symbol)}
        ${renderField('Stock Exchange', account.stock_exchange)}
        ${renderField('IPO Status', account.ipo_status)}
        ${renderField('IPO Date', account.ipo_date)}
      `},
      { id: 'acct_sec', icon: 'bi-bank', label: 'SEC & Regulatory', fields: () => `
        ${renderField('SEC CIK', account.sec_cik)}
        ${renderField('SEC EDGAR', account.sec_edgar_url, { url: true })}
        ${renderField('SEC Filings RSS', account.sec_filings_rss, { url: true })}
        ${renderField('SEC Submissions', account.sec_submissions_url, { url: true })}
      `},
      { id: 'acct_digital', icon: 'bi-laptop', label: 'Digital Footprint', fields: () => `
        ${renderField('Global Traffic Rank', account.global_traffic_rank)}
        ${renderField('Monthly Visits', account.monthly_visits)}
        ${renderField('Bounce Rate', account.bounce_rate)}
        ${renderField('Visit Duration', account.visit_duration)}
        ${renderField('Page Views/Visit', account.page_views_per_visit)}
        ${renderField('Heat Score', account.heat_score)}
        ${renderField('Trend Score (90d)', account.trend_score_90d)}
        ${renderField('Active Tech Count', account.active_tech_count)}
        ${renderField('IT Spend', account.it_spend)}
        ${renderField('Patents Granted', account.patents_granted)}
        ${renderField('Trademarks', account.trademarks_registered)}
      `},
      { id: 'acct_intel', icon: 'bi-link-45deg', label: 'Intelligence URLs', fields: () => `
        ${renderField('Twitter Live', account.twitter_live_url, { url: true })}
        ${renderField('Reddit Query', account.reddit_query)}
        ${renderField('Reddit RSS', account.reddit_rss_url, { url: true })}
        ${renderField('News Query', account.news_query)}
        ${renderField('RSS Feed', account.rss_url, { url: true })}
        ${renderField('Google Patents', account.google_patents_url, { url: true })}
        ${renderField('Google Trends', account.google_trends_url, { url: true })}
        ${renderField('YouTube Search', account.youtube_search_url, { url: true })}
        ${renderField('OpenAlex', account.openalex_institution_url, { url: true })}
        ${renderField('Wikidata', account.wikidata_entity_url, { url: true })}
      `},
      { id: 'acct_tags', icon: 'bi-tags', label: 'Tags & Classifications', fields: () => `
        ${renderField('Industries', account.industries, { chips: true, span2: true })}
        ${renderField('Keywords', account.keywords, { chips: true, span2: true })}
      `},
      { id: 'acct_hierarchy', icon: 'bi-diagram-3', label: 'Hierarchy Metrics', fields: () => `
        ${renderField('LOBs Count', account.lobs_count)}
        ${renderField('Total Contacts', account.total_contacts_captured)}
        ${renderField('C-Suite', account.c_suite_count)}
        ${renderField('VP Level', account.vp_count)}
        ${renderField('Directors', account.director_count)}
        ${renderField('Managers', account.manager_count)}
        ${renderField('Sub-Organizations', account.num_suborganizations)}
        ${renderField('Acquisitions', account.num_acquisitions)}
      `}
    ];

    const pillsHtml = sections.map(s =>
      `<button type="button" class="intel-tag-pill" data-target="${s.id}" title="Click to view ${s.label}"><i class="bi ${s.icon}"></i> ${s.label}</button>`
    ).join('');

    const panelsHtml = sections.map(s =>
      `<div class="intel-tag-panel d-none" id="${s.id}">
        <div class="intel-tag-panel-header"><i class="bi ${s.icon}"></i> ${s.label}</div>
        <div class="detail-grid">${s.fields()}</div>
      </div>`
    ).join('');

    return `
      <div class="intel-tag-row">${pillsHtml}</div>
      <div class="intel-tag-panels">${panelsHtml}</div>
    `;
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
    activeAccount = MOCK_DATA.accounts.find(a => String(a.id) === String(id));
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
    const acctDomain = activeAccount.primary_domain || activeAccount.domain;
    $('#heroAvatar').empty();
    if (acctDomain) {
      const $img = $(`<img src="https://logo.clearbit.com/${esc(acctDomain)}" alt="${esc(activeAccount.name)}" style="width:100%;height:100%;object-fit:contain;padding:4px;background:#fff;border-radius:12px;" />`);
      $img.on('error', function () {
        $('#heroAvatar').empty().text(getInitials(activeAccount.name));
      });
      $('#heroAvatar').append($img);
    } else {
      $('#heroAvatar').text(getInitials(activeAccount.name));
    }

    $('#accountName').text(activeAccount.name);
    $('#accountTicker').text(activeAccount.ticker || 'Enterprise');
    $('#accountRevenue').text(activeAccount.revenue || activeAccount.funding || '$17.5 Billion');
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
        const logoUrl = lob.logo_url || (lob.domain ? `https://logo.clearbit.com/${lob.domain}` : null);
        const subtitle = lob.revenue ? `Rev: ${lob.revenue}` : (lob.desc || 'Business Division');
        $lobCards.append(`
          <div class="compact-card lob-card fade-in" data-lob-id="${lob.id}" title="Click to explore ${esc(lob.name)} division and personas">
            <div class="compact-card-avatar" style="position:relative;overflow:hidden;background:#fff;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;">
              ${logoUrl ? `
                <img src="${esc(logoUrl)}" alt="${esc(lob.name)}" style="width:100%;height:100%;object-fit:contain;padding:3px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                <i class="bi bi-folder2" style="display:none;font-size:1.1rem;color:var(--brand);"></i>
              ` : `
                <i class="bi bi-folder2" style="font-size:1.1rem;color:var(--brand);"></i>
              `}
            </div>
            <div class="compact-card-body">
              <div class="compact-card-title">${esc(lob.name)}</div>
              <div class="compact-card-subtitle">${esc(subtitle)}</div>
            </div>
          </div>
        `);
      });
    }
    
    $('#lobSection').removeClass('d-none');
    $('#accountDataSection').html(renderAccountDataSection(activeAccount)).removeClass('d-none');
    
    // Render Complete Enterprise Hierarchy at Account Level
    renderPersonaCards(activeAccount.personas || [], `${activeAccount.name} — Enterprise Leadership Hierarchy`);
  });

  // Intel Tag Pill toggle handler (Account level)
  $(document).on('click', '.intel-tag-pill', function () {
    const targetId = $(this).data('target');
    const $panel = $(`#${targetId}`);
    const wasVisible = !$panel.hasClass('d-none');

    // Hide all panels in the same container
    $(this).closest('.intel-tag-row').parent().find('.intel-tag-panel').addClass('d-none');
    // Deactivate all pills in this row
    $(this).closest('.intel-tag-row').find('.intel-tag-pill').removeClass('active');

    if (!wasVisible) {
      $panel.removeClass('d-none').hide().slideDown(200);
      $(this).addClass('active');
    }
  });

  window._PERSONA_MAP = window._PERSONA_MAP || {};

  function renderPersonaCards(personas, title) {
    const $personaCards = $('#personaCardsContainer').empty();
    $('#personaSectionTitle').html(`<i class="bi bi-people-fill"></i> ${esc(title || 'Organizational Hierarchy')}`);
    $('#personaCountBadge').text(`(${personas.length} contact${personas.length !== 1 ? 's' : ''})`);

    if (!personas || personas.length === 0) {
      $personaCards.append('<div style="color:var(--text-muted);font-size:.85rem;padding:8px 0;">No executive personas mapped for this division yet.</div>');
    } else {
      personas.forEach((p, idx) => {
        const personaKey = p.key || `persona_${p.id || idx}_${(p.name || 'contact').toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        p.key = personaKey;
        window._PERSONA_MAP[personaKey] = p;
        const tierBadge = p.tier ? `<span style="font-size:0.65rem;background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:4px;margin-left:4px;text-transform:uppercase;">${esc((p.tier || '').replace('_', ' '))}</span>` : '';
        $personaCards.append(`
          <div class="compact-card persona-card fade-in" data-key="${personaKey}" title="Click to view AI call prep, email, and social signals for ${esc(p.name || p.full_name)}">
            <div class="compact-card-avatar">${esc(getInitials(p.name || p.full_name))}</div>
            <div class="compact-card-body">
              <div class="compact-card-title">${esc(p.name || p.full_name)} ${tierBadge}</div>
              <div class="compact-card-subtitle">${esc(p.title || p.job_title || 'Executive')}</div>
            </div>
          </div>
        `);
      });
    }

    $('#personaSection').removeClass('d-none');
  }

  // 3. Handle LOB Card Selection
  $(document).on('click', '.lob-card', function () {
    $('.lob-card').removeClass('active');
    $(this).addClass('active');

    const lobId = $(this).data('lob-id');
    activeLob = activeAccount.lobs.find(l => String(l.id) === String(lobId));
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

    renderPersonaCards(allPersonas, `${activeLob.name} — Division Hierarchy`);

    // Render LOB Detail Panel
    renderLobDetailPanel(activeLob);
  });

  // 4. Handle Persona Card Selection
  $(document).on('click', '.persona-card', function () {
    $('.persona-card').removeClass('active');
    $(this).addClass('active');

    const personaKey = $(this).attr('data-key') || $(this).data('key');
    let pData = window._PERSONA_MAP ? window._PERSONA_MAP[personaKey] : null;
    if (!pData && activeAccount && activeAccount.personas) {
      pData = activeAccount.personas.find(p => p.key === personaKey || String(p.id) === String(personaKey));
    }
    if (!pData) return;
    activePersona = pData;

    $('#crumbs').html(`
      <li class="breadcrumb-item"><a href="javascript:void(0)" class="crumb-account">${esc(activeAccount.name)}</a></li>
      ${activeLob ? `<li class="breadcrumb-item"><a href="javascript:void(0)" class="crumb-lob">${esc(activeLob.name)}</a></li>` : ''}
      <li class="breadcrumb-item active">${esc(activePersona.name || activePersona.full_name)}</li>
    `);

    renderPersonaDetailPanel(activePersona);
  });

  // Breadcrumb navigation
  $(document).on('click', '.crumb-account', function () {
    if (!activeAccount) return;
    $('.lob-card').removeClass('active');
    activeLob = null;
    activePersona = null;
    $('#detailPanelContainer').addClass('d-none').empty();
    $('#crumbs').html(`<li class="breadcrumb-item active">${esc(activeAccount.name)}</li>`);
    renderPersonaCards(activeAccount.personas || [], `${activeAccount.name} — Enterprise Leadership Hierarchy`);
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
        <div class="detail-panel-header" style="display:flex;align-items:flex-start;gap:14px;">
          ${lob.logo_url ? `
            <img src="${esc(lob.logo_url)}" alt="${esc(lob.name)}" style="width:48px;height:48px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid #e2e8f0;padding:3px;flex-shrink:0;" onerror="this.style.display='none';" />
          ` : ''}
          <div style="flex:1;">
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

        <!-- LOB Data Tag Pills -->
        <div class="intel-tag-row">
          <button type="button" class="intel-tag-pill" data-target="lob_overview_${lob.id}"><i class="bi bi-building"></i> Overview & Structure</button>
          <button type="button" class="intel-tag-pill" data-target="lob_finance_${lob.id}"><i class="bi bi-bar-chart-line"></i> Segment Financials</button>
          <button type="button" class="intel-tag-pill" data-target="lob_legal_${lob.id}"><i class="bi bi-bank"></i> Regulatory & Legal</button>
          <button type="button" class="intel-tag-pill" data-target="lob_tech_${lob.id}"><i class="bi bi-cpu"></i> Tech Stack</button>
          <button type="button" class="intel-tag-pill" data-target="lob_compete_${lob.id}"><i class="bi bi-people"></i> Competitors</button>
          <button type="button" class="intel-tag-pill" data-target="lob_finsnip_${lob.id}"><i class="bi bi-graph-up"></i> Financial Analysis</button>
          <button type="button" class="intel-tag-pill" data-target="lob_patents_${lob.id}"><i class="bi bi-lightbulb"></i> Patents</button>
          <button type="button" class="intel-tag-pill" data-target="lob_feeds_${lob.id}"><i class="bi bi-broadcast"></i> Intelligence Feeds</button>
          <button type="button" class="intel-tag-pill" data-target="lob_osint_${lob.id}"><i class="bi bi-link-45deg"></i> OSINT URLs</button>
          ${(lob.subLobs && lob.subLobs.length) ? `<button type="button" class="intel-tag-pill" data-target="lob_sublobs_${lob.id}"><i class="bi bi-folder-symlink"></i> Sub-Divisions (${lob.subLobs.length})</button>` : ''}
        </div>

        <div class="intel-tag-panels">
          <div class="intel-tag-panel d-none" id="lob_overview_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-building"></i> Overview & Corporate Structure</div>
            <div class="detail-grid">
              ${renderField('Division Overview', lob.overview || lob.desc, { span2: true })}
              ${renderField('Division Name', lob.lob_name || lob.name)}
              ${renderField('Key', lob.key)}
              ${renderField('Relationship Type', lob.relationship_type)}
              ${renderField('Primary Domain', lob.domain)}
              ${renderField('Website', lob.website_url, { url: true })}
              ${renderField('Crunchbase', lob.crunchbase_url, { url: true })}
              ${renderField('Wikipedia', lob.wikipedia_url, { url: true })}
              ${renderField('Logo URL', lob.logo_url, { url: true })}
              ${renderField('Database ID', lob.id)}
              ${renderField('Account ID', lob.account_id || (activeAccount ? activeAccount.id : null))}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_finance_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-bar-chart-line"></i> Segment Financials & Scale</div>
            <div class="detail-grid">
              ${renderField('Segment Revenue', lob.revenue || lob.audited_segment_revenue)}
              ${renderField('Headcount', lob.headcount || lob.segment_headcount)}
              ${renderField('Operating Head', lob.operating_head)}
              ${renderField('Mapped Contacts', lob.personas ? lob.personas.length + ' identified' : '0')}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_legal_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-bank"></i> Regulatory & Legal</div>
            <div class="detail-grid">
              ${renderField('LEI Code', lob.lei_code)}
              ${renderField('Jurisdiction', lob.jurisdiction)}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_tech_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-cpu"></i> Technology Stack</div>
            <div class="detail-grid">
              ${renderField('Technologies', lob.technologies, { chips: true, span2: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_compete_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-people"></i> Competitive Landscape</div>
            <div class="detail-grid">
              ${renderField('Competitors', lob.competitors, { chips: true, span2: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_finsnip_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-graph-up"></i> Financial Analysis</div>
            <div class="detail-grid">
              ${renderField('Financial Snippets', lob.financial_snippets, { json: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_patents_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-lightbulb"></i> Patent Portfolio</div>
            <div class="detail-grid">
              ${renderField('Patents', lob.patents, { json: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_feeds_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-broadcast"></i> Live Intelligence Feeds</div>
            <div class="detail-grid">
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="linkedin" data-title="LinkedIn Intelligence Summary" data-entity="${esc(lob.name)}" data-url="${lob.linkedin_url ? esc(lob.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(lob.name + ' ' + (activeAccount ? activeAccount.name : ''))}`}" title="LinkedIn activity summary"><span class="feed-title"><i class="bi bi-linkedin" style="color:#0077b5;"></i> LinkedIn <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${lob.linkedin_url ? esc(lob.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.linkedin}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="x_twitter" data-title="Twitter / X Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.twitter_live_url || `https://x.com/search?q=${encodeURIComponent(lob.name)}&f=live`}"><span class="feed-title"><i class="bi bi-twitter-x"></i> Twitter / X <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${lob.twitter_live_url || `https://x.com/search?q=${encodeURIComponent(lob.name)}&f=live`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.x_twitter}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="reddit" data-title="Reddit Community Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.reddit_rss_url || `https://www.reddit.com/search/?q=${encodeURIComponent(lob.name)}`}"><span class="feed-title"><i class="bi bi-reddit" style="color:#ff4500;"></i> Reddit <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${lob.reddit_rss_url || `https://www.reddit.com/search/?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.reddit}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="youtube" data-title="YouTube Media Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.youtube_search_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(lob.name)}`}"><span class="feed-title"><i class="bi bi-youtube" style="color:#ff0000;"></i> YouTube <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${lob.youtube_search_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.youtube}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="google_news" data-title="Google News Feed" data-entity="${esc(lob.name)}" data-url="${lob.google_news_rss_url || `https://news.google.com/rss/search?q=${encodeURIComponent(lob.name)}`}"><span class="feed-title"><i class="bi bi-newspaper" style="color:#4285f4;"></i> Google News <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${lob.google_news_rss_url || `https://news.google.com/rss/search?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.google_news}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="google_patents" data-title="Patent & IP Intelligence" data-entity="${esc(lob.name)}" data-url="${lob.google_patents_url || `https://patents.google.com/?q=${encodeURIComponent(lob.name)}`}"><span class="feed-title"><i class="bi bi-lightbulb" style="color:#34a853;"></i> Patents <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${lob.google_patents_url || `https://patents.google.com/?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.google_patents}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="google_trends" data-title="Search Trends Analytics" data-entity="${esc(lob.name)}" data-url="${lob.google_trends_url || `https://trends.google.com/trends/explore?q=${encodeURIComponent(lob.name)}`}"><span class="feed-title"><i class="bi bi-graph-up" style="color:#ea4335;"></i> Trends <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${lob.google_trends_url || `https://trends.google.com/trends/explore?q=${encodeURIComponent(lob.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.google_trends}</a>
              </div>
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="lob_osint_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-link-45deg"></i> OSINT Intelligence URLs</div>
            <div class="detail-grid">
              ${renderField('Google News RSS', lob.google_news_rss_url, { url: true })}
              ${renderField('Reddit RSS', lob.reddit_rss_url, { url: true })}
              ${renderField('Google Patents', lob.google_patents_url, { url: true })}
              ${renderField('Google Trends', lob.google_trends_url, { url: true })}
              ${renderField('YouTube Search', lob.youtube_search_url, { url: true })}
            </div>
          </div>

          ${(lob.subLobs && lob.subLobs.length) ? `
          <div class="intel-tag-panel d-none" id="lob_sublobs_${lob.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-folder-symlink"></i> Sub-Divisions & Operating Groups (${lob.subLobs.length})</div>
            <div class="detail-grid">
              ${lob.subLobs.map(s => `
                <div class="detail-field">
                  <div class="detail-label">Division Name</div>
                  <div class="detail-val" style="font-weight:600;">${esc(s.name)}</div>
                  ${s.desc ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:2px;">${esc(s.desc)}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>` : ''}
        </div>

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

        <!-- Persona Data Tag Pills -->
        <div class="intel-tag-row">
          <button type="button" class="intel-tag-pill" data-target="p_profile_${p.id}"><i class="bi bi-person-vcard"></i> Executive Profile</button>
          <button type="button" class="intel-tag-pill" data-target="p_contact_${p.id}"><i class="bi bi-telephone"></i> Contact Info</button>
          <button type="button" class="intel-tag-pill" data-target="p_career_${p.id}"><i class="bi bi-briefcase"></i> Career & Employment</button>
          <button type="button" class="intel-tag-pill" data-target="p_academic_${p.id}"><i class="bi bi-mortarboard"></i> Academic</button>
          <button type="button" class="intel-tag-pill" data-target="p_dossier_${p.id}"><i class="bi bi-robot"></i> AI Sales Dossier</button>
          <button type="button" class="intel-tag-pill" data-target="p_kpis_${p.id}"><i class="bi bi-bullseye"></i> KPIs & Skills</button>
          <button type="button" class="intel-tag-pill" data-target="p_authority_${p.id}"><i class="bi bi-shield-lock"></i> Decision Authority</button>
          <button type="button" class="intel-tag-pill" data-target="p_feeds_${p.id}"><i class="bi bi-broadcast-pin"></i> Intelligence Feeds</button>
          <button type="button" class="intel-tag-pill" data-target="p_osint_${p.id}"><i class="bi bi-link-45deg"></i> OSINT URLs</button>
        </div>

        <div class="intel-tag-panels">
          <div class="intel-tag-panel d-none" id="p_profile_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-person-vcard"></i> Executive Profile</div>
            <div class="detail-grid">
              ${renderField('Display Name', p.display_name || p.name)}
              ${renderField('First Name', p.first_name)}
              ${renderField('Last Name', p.last_name)}
              ${renderField('Headline', p.headline, { span2: true })}
              ${renderField('Seniority (Raw)', p.seniority_raw)}
              ${renderField('Hierarchy Level', p.hierarchy_level)}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_contact_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-telephone"></i> Contact Information</div>
            <div class="detail-grid">
              ${renderField('Corporate Email', p.email)}
              ${renderField('Email Status', p.email_status)}
              ${renderField('Corporate Phone', p.phone)}
              ${renderField('Personal Email', p.personal_email)}
              ${renderField('Direct Mobile', p.direct_mobile_phone)}
              ${renderField('City', p.city)}
              ${renderField('State', p.state)}
              ${renderField('Country', p.country)}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_career_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-briefcase"></i> Career & Employment</div>
            <div class="detail-grid">
              ${renderField('Prior Company', p.prior_company)}
              ${renderField('Current Role Tenure', p.current_role_tenure_months ? Math.floor(p.current_role_tenure_months / 12) + ' years ' + (p.current_role_tenure_months % 12) + ' months' : '')}
              <div class="detail-field">
                <div class="detail-label">New in Role</div>
                <div class="detail-val">${p.is_new_in_role ? '<span class="pill pill-brand">Yes</span>' : '<span class="text-muted">No</span>'}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">Career Trajectory Score</div>
                <div class="detail-val">
                  <div style="width:100%;background:#e2e8f0;border-radius:4px;height:12px;margin-top:6px;overflow:hidden;">
                    <div style="height:100%;width:${p.career_trajectory_score || 0}%;background:var(--brand);"></div>
                  </div>
                  <div style="font-size:0.75rem;margin-top:2px;">${p.career_trajectory_score || 0}/100</div>
                </div>
              </div>
              ${renderField('Past Companies', p.past_companies, { chips: true, span2: true })}
              ${renderField('Previous Titles', p.previous_titles, { chips: true, span2: true })}
              ${renderField('Employment History', p.employment_history, { json: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_academic_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-mortarboard"></i> Academic Background</div>
            <div class="detail-grid">
              ${renderField('Degree', p.degree)}
              ${renderField('Institution', p.institution)}
              ${renderField('Education History', p.education_history, { json: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_dossier_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-robot"></i> AI Sales Dossier</div>
            <div class="detail-grid">
              ${renderField('Communication Style', p.communication_style)}
              ${renderField('Value Proposition', p.value_proposition)}
              ${renderField('Personalized Icebreaker', p.personalized_icebreaker, { span2: true })}
              ${renderField('Engagement Rate', p.engagement_rate)}
              ${renderField('Social Platform', p.social_platform)}
              ${renderField('Social Profile URL', p.social_profile_url, { url: true })}
              ${renderField('Social Presence Level', p.social_presence_level)}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_kpis_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-bullseye"></i> Strategic Priorities & KPIs</div>
            <div class="detail-grid">
              ${renderField('Core Skills', p.skills, { chips: true, span2: true })}
              ${renderField('Target KPIs', p.target_kpis, { chips: true, span2: true })}
              ${renderField('Operational Pain Points', p.operational_pain_points, { chips: true, span2: true })}
              ${renderField('Key Objections', p.key_objections, { chips: true, span2: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_authority_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-shield-lock"></i> Decision Authority</div>
            <div class="detail-grid">
              ${renderField('Decision Authority', p.decision_authority)}
              ${renderField('Budget Authority', p.budget_authority)}
              ${renderField('Departments', p.departments, { chips: true, span2: true })}
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_feeds_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-broadcast-pin"></i> Executive Online Footprint</div>
            <div class="detail-grid">
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="linkedin" data-title="LinkedIn Executive Intelligence" data-entity="${esc(p.name)}" data-url="${p.linkedin_url ? esc(p.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(p.name + ' ' + activeAccount.name)}`}"><span class="feed-title"><i class="bi bi-linkedin" style="color:#0077b5;"></i> LinkedIn <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${p.linkedin_url ? esc(p.linkedin_url) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(p.name + ' ' + activeAccount.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.linkedin}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="x_twitter" data-title="Twitter / X Executive Intelligence" data-entity="${esc(p.name)}" data-url="${p.twitter_live_url ? esc(p.twitter_live_url) : `https://x.com/search?q=${encodeURIComponent(p.name)}&f=live`}"><span class="feed-title"><i class="bi bi-twitter-x"></i> Twitter / X <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${p.twitter_live_url ? esc(p.twitter_live_url) : `https://x.com/search?q=${encodeURIComponent(p.name)}&f=live`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.x_twitter}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="reddit" data-title="Reddit Community Discussions" data-entity="${esc(p.name)}" data-url="${p.reddit_rss_url ? esc(p.reddit_rss_url) : `https://www.reddit.com/search/?q=${encodeURIComponent(p.name)}`}"><span class="feed-title"><i class="bi bi-reddit" style="color:#ff4500;"></i> Reddit <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${p.reddit_rss_url ? esc(p.reddit_rss_url) : `https://www.reddit.com/search/?q=${encodeURIComponent(p.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.reddit}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="youtube" data-title="YouTube Keynotes & Interviews" data-entity="${esc(p.name)}" data-url="${p.youtube_interviews_url ? esc(p.youtube_interviews_url) : `https://www.youtube.com/results?search_query=${encodeURIComponent(p.name + ' interview')}`}"><span class="feed-title"><i class="bi bi-youtube" style="color:#ff0000;"></i> YouTube <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${p.youtube_interviews_url ? esc(p.youtube_interviews_url) : `https://www.youtube.com/results?search_query=${encodeURIComponent(p.name + ' interview')}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.youtube}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="google_news" data-title="Google News Executive Coverage" data-entity="${esc(p.name)}" data-url="${p.rss_url ? esc(p.rss_url) : `https://news.google.com/rss/search?q=${encodeURIComponent(p.name)}`}"><span class="feed-title"><i class="bi bi-newspaper" style="color:#4285f4;"></i> Google News <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${p.rss_url ? esc(p.rss_url) : `https://news.google.com/rss/search?q=${encodeURIComponent(p.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.google_news}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="google_patents" data-title="Inventor Patent Portfolio" data-entity="${esc(p.name)}" data-url="${p.google_patents_url ? esc(p.google_patents_url) : `https://patents.google.com/?inventor=${encodeURIComponent(p.name)}`}"><span class="feed-title"><i class="bi bi-lightbulb" style="color:#34a853;"></i> Patents <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${p.google_patents_url ? esc(p.google_patents_url) : `https://patents.google.com/?inventor=${encodeURIComponent(p.name)}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.google_patents}</a>
              </div>
              <div class="feed-btn-card">
                <button type="button" class="feed-title-btn" data-platform="podcast" data-title="Podcasts & Media Intelligence" data-entity="${esc(p.name)}" data-url="${p.podcast_search_url ? esc(p.podcast_search_url) : `https://www.google.com/search?q=${encodeURIComponent(p.name + ' podcast')}`}"><span class="feed-title"><i class="bi bi-mic" style="color:#8743d6;"></i> Podcasts <i class="bi bi-chevron-right" style="font-size:.7rem;margin-left:auto;"></i></span></button>
                <a href="${p.podcast_search_url ? esc(p.podcast_search_url) : `https://www.google.com/search?q=${encodeURIComponent(p.name + ' podcast')}`}" target="_blank" class="feed-right-icon-link">${BRAND_ICONS.podcast}</a>
              </div>
            </div>
          </div>

          <div class="intel-tag-panel d-none" id="p_osint_${p.id}">
            <div class="intel-tag-panel-header"><i class="bi bi-link-45deg"></i> OSINT Intelligence URLs</div>
            <div class="detail-grid">
              ${renderField('LinkedIn', p.linkedin_url, { url: true })}
              ${renderField('Twitter Live', p.twitter_live_url, { url: true })}
              ${renderField('Reddit RSS', p.reddit_rss_url, { url: true })}
              ${renderField('SEC Insider Trades', p.sec_insider_trades_url, { url: true })}
              ${renderField('Google Patents', p.google_patents_url, { url: true })}
              ${renderField('Google Scholar', p.google_scholar_url, { url: true })}
              ${renderField('OpenAlex Author', p.openalex_author_url, { url: true })}
              ${renderField('ORCID Search', p.orcid_search_url, { url: true })}
              ${renderField('Wikidata Person', p.wikidata_person_url, { url: true })}
              ${renderField('YouTube Interviews', p.youtube_interviews_url, { url: true })}
              ${renderField('Podcast Search', p.podcast_search_url, { url: true })}
              ${renderField('Google Trends', p.google_trends_url, { url: true })}
              ${renderField('Twitter Handle', p.twitter_handle)}
              ${renderField('Reddit Query', p.reddit_query)}
              ${renderField('News Query', p.news_query)}
              ${renderField('RSS Feed', p.rss_url, { url: true })}
              ${renderField('Patents Query', p.patents_query)}
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

  function renderField(label, value, opts = {}) {
    if (value === null || value === undefined || value === '') {
      return `<div class="detail-field${opts.span2 ? ' span-2' : ''}"><div class="detail-label">${label}</div><div class="detail-val" style="color:var(--text-muted);font-style:italic;">—</div></div>`;
    }
    if (opts.url && value) {
      const display = opts.urlLabel || (typeof value === 'string' && value.length > 60 ? value.substring(0, 60) + '...' : value);
      return `<div class="detail-field${opts.span2 ? ' span-2' : ''}"><div class="detail-label">${label}</div><div class="detail-val"><a href="${esc(value)}" target="_blank" style="word-break:break-all;">${esc(display)} <i class="bi bi-box-arrow-up-right" style="font-size:.7rem;"></i></a></div></div>`;
    }
    if (opts.chips && Array.isArray(value) && value.length) {
      return `<div class="detail-field${opts.span2 ? ' span-2' : ''}"><div class="detail-label">${label}</div><div class="detail-val">${value.map(v => `<span class="data-tag">${esc(String(v))}</span>`).join(' ')}</div></div>`;
    }
    if (opts.json && typeof value === 'object') {
      return `<div class="detail-field span-2"><div class="detail-label">${label}</div><div class="detail-val">${renderJsonSmart(label, value)}</div></div>`;
    }
    return `<div class="detail-field${opts.span2 ? ' span-2' : ''}"><div class="detail-label">${label}</div><div class="detail-val">${esc(String(value))}</div></div>`;
  }

  // Smart JSONB renderer — detects known structures and renders them as cards
  function renderJsonSmart(label, data) {
    if (!data) return '<span style="color:var(--text-muted);font-style:italic;">—</span>';
    const lbl = label.toLowerCase();

    // ── Employment History (array of role objects)
    if (lbl.includes('employment') && Array.isArray(data) && data.length) {
      return `<div class="json-card-list">${data.map(job => {
        const title = job.title || job.role || 'Role';
        const company = job.company || job.organization || '';
        const start = job.start_date || job.from || '';
        const end = job.end_date || job.to || (job.is_current ? 'Present' : '');
        const desc = job.description || '';
        return `<div class="json-card">
          <div class="json-card-title"><i class="bi bi-briefcase"></i> ${esc(title)}</div>
          ${company ? `<div class="json-card-sub">${esc(company)}</div>` : ''}
          ${(start || end) ? `<div class="json-card-meta"><i class="bi bi-calendar3"></i> ${esc(start)}${start && end ? ' → ' : ''}${esc(end)}</div>` : ''}
          ${desc ? `<div class="json-card-desc">${esc(desc)}</div>` : ''}
        </div>`;
      }).join('')}</div>`;
    }

    // ── Education History (array of education objects)
    if (lbl.includes('education') && Array.isArray(data) && data.length) {
      return `<div class="json-card-list">${data.map(edu => {
        const degree = edu.degree || edu.qualification || '';
        const institution = edu.institution || edu.school || edu.university || '';
        const field = edu.field_of_study || edu.major || edu.field || '';
        const year = edu.graduation_year || edu.year || edu.end_date || '';
        return `<div class="json-card">
          <div class="json-card-title"><i class="bi bi-mortarboard"></i> ${esc(degree || 'Degree')}</div>
          ${institution ? `<div class="json-card-sub">${esc(institution)}</div>` : ''}
          ${field ? `<div class="json-card-meta"><i class="bi bi-book"></i> ${esc(field)}</div>` : ''}
          ${year ? `<div class="json-card-meta"><i class="bi bi-calendar3"></i> ${esc(String(year))}</div>` : ''}
        </div>`;
      }).join('')}</div>`;
    }

    // ── Financial Snippets / Technologies / Competitors / Patents (array of strings or objects)
    if (Array.isArray(data)) {
      if (data.length === 0) return '<span style="color:var(--text-muted);font-style:italic;">—</span>';
      // Array of strings → chips
      if (typeof data[0] === 'string') {
        return data.map(v => `<span class="data-tag">${esc(v)}</span>`).join(' ');
      }
      // Array of objects → card list
      return `<div class="json-card-list">${data.map(item => {
        if (typeof item === 'string') return `<div class="json-card"><div class="json-card-desc">${esc(item)}</div></div>`;
        const entries = Object.entries(item).filter(([k,v]) => v !== null && v !== undefined && v !== '');
        return `<div class="json-card">${entries.map(([k, v]) =>
          `<div class="json-card-row"><span class="json-card-key">${esc(k.replace(/_/g, ' '))}</span><span class="json-card-value">${esc(String(v))}</span></div>`
        ).join('')}</div>`;
      }).join('')}</div>`;
    }

    // ── Plain object → key-value card
    if (typeof data === 'object' && !Array.isArray(data)) {
      const entries = Object.entries(data).filter(([k,v]) => v !== null && v !== undefined && v !== '');
      if (entries.length === 0) return '<span style="color:var(--text-muted);font-style:italic;">—</span>';
      return `<div class="json-card">${entries.map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `<div class="json-card-row"><span class="json-card-key">${esc(k.replace(/_/g, ' '))}</span><span class="json-card-value">${esc(val)}</span></div>`;
      }).join('')}</div>`;
    }

    return `<span>${esc(String(data))}</span>`;
  }

  // ─── Batch Sequential Pipeline (Pull All → Validate All → Dump All) ─────

  // Batch state tracking
  let lobBatchState = { pulled: false, validated: false, dumped: false, running: false, stagedData: [] };
  let personaBatchState = { pulled: false, validated: false, dumped: false, running: false, stagedData: [] };

  // Reset batch state when account changes
  function resetBatchStates() {
    lobBatchState = { pulled: false, validated: false, dumped: false, running: false, stagedData: [] };
    personaBatchState = { pulled: false, validated: false, dumped: false, running: false, stagedData: [] };

    // Reset LOB buttons
    $('#lobBatchPull').prop('disabled', false).removeClass('running done').html('<i class="bi bi-cloud-arrow-down"></i> Pull All');
    $('#lobBatchValidate').prop('disabled', true).removeClass('running done').html('<i class="bi bi-shield-check"></i> Validate All');
    $('#lobBatchDump').prop('disabled', true).removeClass('running done').html('<i class="bi bi-database-check"></i> Dump All');
    $('#lobBatchProgress').addClass('d-none');

    // Reset Persona buttons
    $('#personaBatchPull').prop('disabled', false).removeClass('running done').html('<i class="bi bi-cloud-arrow-down"></i> Pull All');
    $('#personaBatchValidate').prop('disabled', true).removeClass('running done').html('<i class="bi bi-shield-check"></i> Validate All');
    $('#personaBatchDump').prop('disabled', true).removeClass('running done').html('<i class="bi bi-database-check"></i> Dump All');
    $('#personaBatchProgress').addClass('d-none');
  }

  // Hook into account selection to reset batch states
  const origAccountClick = $(document).data('events');
  $(document).on('click', '.account-item', function () {
    setTimeout(resetBatchStates, 100);
  });

  // ─── Sequential LOB Batch Pipeline ───────────────────────────────────────

  async function runBatchLobPipeline(action) {
    if (!activeAccount || lobBatchState.running) return;
    const lobs = activeAccount.lobs || [];
    if (lobs.length === 0) return;

    lobBatchState.running = true;
    const $progress = $('#lobBatchProgress').removeClass('d-none');
    const $fill = $('#lobProgressFill');
    const $status = $('#lobBatchStatus');

    // Set progress bar color based on action
    $fill.removeClass('validate dump');
    if (action === 'validate') $fill.addClass('validate');
    if (action === 'dump') $fill.addClass('dump');

    const $pullBtn = $('#lobBatchPull');
    const $validateBtn = $('#lobBatchValidate');
    const $dumpBtn = $('#lobBatchDump');

    let successCount = 0;
    let failCount = 0;

    // Disable all batch buttons during run
    $pullBtn.prop('disabled', true);
    $validateBtn.prop('disabled', true);
    $dumpBtn.prop('disabled', true);

    const actionBtn = action === 'pull' ? $pullBtn : (action === 'validate' ? $validateBtn : $dumpBtn);
    const actionLabel = action === 'pull' ? 'Pulling' : (action === 'validate' ? 'Validating' : 'Dumping');
    actionBtn.addClass('running').html(`<i class="bi bi-hourglass-split"></i> ${actionLabel}...`);

    for (let i = 0; i < lobs.length; i++) {
      const lob = lobs[i];
      const pct = Math.round(((i) / lobs.length) * 100);
      $fill.css('width', pct + '%');
      $status.html(`<span class="batch-count">${i + 1}/${lobs.length}</span> ${actionLabel}: <strong>${esc(lob.name)}</strong>... <span class="batch-success">${successCount} ✔</span>${failCount ? ` <span class="batch-fail">${failCount} ✘</span>` : ''}`);

      // Highlight the current LOB card
      $(`.lob-card[data-lob-id="${lob.id}"]`).addClass('active');

      try {
        if (action === 'pull') {
          const lobKey = `lob_${lob.id}`;
          const staged = {
            key: lobKey,
            name: lob.name,
            account_id: activeAccount.id,
            desc: lob.desc || lob.overview
          };
          // Call LOB fetch API
          const res = await fetch('/api/lobs/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_id: activeAccount.id,
              company_name: activeAccount.name,
              lob_name: lob.name,
              lob_domain: lob.domain || null
            })
          });
          if (res.ok) {
            const data = await res.json();
            lobBatchState.stagedData[i] = data.lob || data || staged;
            successCount++;
          } else {
            lobBatchState.stagedData[i] = staged;
            successCount++; // Stage with local data as fallback
          }
        } else if (action === 'validate') {
          const staged = lobBatchState.stagedData[i] || lob;
          const res = await fetch('/api/personas/validate-single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(staged)
          });
          if (res.ok) {
            const data = await res.json();
            lobBatchState.stagedData[i] = lobBatchState.stagedData[i] || lob;
            lobBatchState.stagedData[i]._score = data.score;
            successCount++;
          } else {
            successCount++; // Continue even on validation errors
          }
        } else if (action === 'dump') {
          const staged = lobBatchState.stagedData[i] || lob;
          const res = await fetch('/api/personas/dump-single-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_id: activeAccount.id,
              person_data: staged
            })
          });
          if (res.ok) {
            successCount++;
          } else {
            failCount++;
          }
        }
      } catch (err) {
        console.error(`Batch ${action} failed for LOB "${lob.name}":`, err);
        failCount++;
      }

      // Un-highlight
      $(`.lob-card[data-lob-id="${lob.id}"]`).removeClass('active');
    }

    // Complete
    $fill.css('width', '100%');
    $status.html(`<strong>✔ Complete:</strong> <span class="batch-success">${successCount} succeeded</span>${failCount ? ` · <span class="batch-fail">${failCount} failed</span>` : ''} out of ${lobs.length} LOBs`);
    actionBtn.removeClass('running').addClass('done');

    if (action === 'pull') {
      lobBatchState.pulled = true;
      actionBtn.html('<i class="bi bi-cloud-arrow-down"></i> Pulled ✔');
      $validateBtn.prop('disabled', false);
    } else if (action === 'validate') {
      lobBatchState.validated = true;
      actionBtn.html('<i class="bi bi-shield-check"></i> Validated ✔');
      $dumpBtn.prop('disabled', false);
    } else if (action === 'dump') {
      lobBatchState.dumped = true;
      actionBtn.html('<i class="bi bi-database-check"></i> Dumped ✔');
    }

    lobBatchState.running = false;
  }

  // ─── Sequential Persona Batch Pipeline ───────────────────────────────────

  async function runBatchPersonaPipeline(action) {
    if (!activeAccount || personaBatchState.running) return;

    // Get current personas (could be filtered by LOB)
    const personas = activeLob
      ? [...(activeLob.personas || []), ...((activeLob.subLobs || []).flatMap(s => s.personas || []))]
      : (activeAccount.personas || []);
    if (personas.length === 0) return;

    personaBatchState.running = true;
    const $progress = $('#personaBatchProgress').removeClass('d-none');
    const $fill = $('#personaProgressFill');
    const $status = $('#personaBatchStatus');

    $fill.removeClass('validate dump');
    if (action === 'validate') $fill.addClass('validate');
    if (action === 'dump') $fill.addClass('dump');

    const $pullBtn = $('#personaBatchPull');
    const $validateBtn = $('#personaBatchValidate');
    const $dumpBtn = $('#personaBatchDump');

    let successCount = 0;
    let failCount = 0;

    $pullBtn.prop('disabled', true);
    $validateBtn.prop('disabled', true);
    $dumpBtn.prop('disabled', true);

    const actionBtn = action === 'pull' ? $pullBtn : (action === 'validate' ? $validateBtn : $dumpBtn);
    const actionLabel = action === 'pull' ? 'Pulling' : (action === 'validate' ? 'Validating' : 'Dumping');
    actionBtn.addClass('running').html(`<i class="bi bi-hourglass-split"></i> ${actionLabel}...`);

    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      const personaName = p.name || p.full_name || 'Contact';
      const pct = Math.round(((i) / personas.length) * 100);
      $fill.css('width', pct + '%');
      $status.html(`<span class="batch-count">${i + 1}/${personas.length}</span> ${actionLabel}: <strong>${esc(personaName)}</strong>... <span class="batch-success">${successCount} ✔</span>${failCount ? ` <span class="batch-fail">${failCount} ✘</span>` : ''}`);

      // Highlight the current persona card
      const pKey = p.key || `persona_${p.id || i}`;
      $(`.persona-card[data-key="${pKey}"]`).addClass('active');

      try {
        if (action === 'pull') {
          const res = await fetch('/api/personas/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: (personaName).toLowerCase().replace(/\s+/g, '_'),
              display_name: personaName,
              linkedin_url: p.linkedin_url || null,
              account_id: activeAccount.id,
              enrich_ai_dossier: true
            })
          });
          if (res.ok) {
            const data = await res.json();
            personaBatchState.stagedData[i] = data.person || data;
            successCount++;
          } else {
            personaBatchState.stagedData[i] = p;
            successCount++;
          }
        } else if (action === 'validate') {
          const staged = personaBatchState.stagedData[i] || p;
          const res = await fetch('/api/personas/validate-single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(staged)
          });
          if (res.ok) {
            const data = await res.json();
            personaBatchState.stagedData[i] = personaBatchState.stagedData[i] || p;
            personaBatchState.stagedData[i]._score = data.score;
            successCount++;
          } else {
            successCount++;
          }
        } else if (action === 'dump') {
          const staged = personaBatchState.stagedData[i] || p;
          const res = await fetch('/api/personas/dump-single-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_id: activeAccount.id,
              person_data: staged
            })
          });
          if (res.ok) {
            successCount++;
          } else {
            failCount++;
          }
        }
      } catch (err) {
        console.error(`Batch ${action} failed for persona "${personaName}":`, err);
        failCount++;
      }

      // Un-highlight
      $(`.persona-card[data-key="${pKey}"]`).removeClass('active');
    }

    // Complete
    $fill.css('width', '100%');
    $status.html(`<strong>✔ Complete:</strong> <span class="batch-success">${successCount} succeeded</span>${failCount ? ` · <span class="batch-fail">${failCount} failed</span>` : ''} out of ${personas.length} personas`);
    actionBtn.removeClass('running').addClass('done');

    if (action === 'pull') {
      personaBatchState.pulled = true;
      actionBtn.html('<i class="bi bi-cloud-arrow-down"></i> Pulled ✔');
      $validateBtn.prop('disabled', false);
    } else if (action === 'validate') {
      personaBatchState.validated = true;
      actionBtn.html('<i class="bi bi-shield-check"></i> Validated ✔');
      $dumpBtn.prop('disabled', false);
    } else if (action === 'dump') {
      personaBatchState.dumped = true;
      actionBtn.html('<i class="bi bi-database-check"></i> Dumped ✔');
    }

    personaBatchState.running = false;
  }

  // ─── Batch Button Click Handlers ─────────────────────────────────────────

  // LOB batch buttons
  $('#lobBatchPull').on('click', function () { runBatchLobPipeline('pull'); });
  $('#lobBatchValidate').on('click', function () { runBatchLobPipeline('validate'); });
  $('#lobBatchDump').on('click', function () { runBatchLobPipeline('dump'); });

  // Persona batch buttons
  $('#personaBatchPull').on('click', function () { runBatchPersonaPipeline('pull'); });
  $('#personaBatchValidate').on('click', function () { runBatchPersonaPipeline('validate'); });
  $('#personaBatchDump').on('click', function () { runBatchPersonaPipeline('dump'); });

});

