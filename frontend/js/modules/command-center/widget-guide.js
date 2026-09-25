/**
 * Widget Guide & Explanations for Sales Command Center
 * Provides concise, informative sales guidance on clicking the '?' button on each widget.
 */

export const WIDGET_GUIDES = {
  matrix: {
    title: 'Account Priority Matrix',
    icon: 'fa-solid fa-table-cells',
    badge: 'Prioritization & Strategy',
    summary: 'Plots monitored enterprise accounts across buying urgency (signal velocity) and deal potential (strategic value). Bubble size reflects estimated contract value.',
    actionTip: 'Focus daily prospecting on top-right quadrant accounts with high urgency and high value. Click any bubble to open the account dossier.',
    signals: 'SEC 10-K Disclosures, Multi-Source Intent Signals & Form 8-K Filings',
  },
  priority_feed: {
    title: 'Priority Signal Feed',
    icon: 'fa-solid fa-bolt',
    badge: 'Real-Time Intent Feed',
    summary: 'Real-time stream of high-impact buying intent triggers—such as hiring surges, executive appointments, earnings calls, and tech migrations—scored from 1 to 100.',
    actionTip: 'Filter by signal category or account, then click "Draft outreach" to generate an AI-tailored pitch referencing that exact trigger.',
    signals: 'SEC Filings (EDGAR 10-K/10-Q), Verified LinkedIn Posts (Apify), PR Newswire & Tech Scrapers',
  },
  playbook: {
    title: "This Week's Playbook",
    icon: 'fa-solid fa-bookmark',
    badge: 'Weekly Action Plan',
    summary: 'AI-synthesized, prescriptive weekly game plan highlighting the highest-leverage outreach plays across your target accounts.',
    actionTip: 'Treat this as your weekly checklist. It specifies which accounts have active buying windows and the exact pitch angle to lead with.',
    signals: 'AI Account Strategy Engine & Buying Triggers',
  },
  timeline: {
    title: 'Executive Movements',
    icon: 'fa-solid fa-clock-rotate-left',
    badge: 'Leadership Shifts',
    summary: 'Chronological timeline of leadership appointments, promotions, and departures across key buying committee personas over the last 30 days.',
    actionTip: 'Engage newly appointed executives during their first 90 days when they are evaluating new vendors and establishing modernization budgets.',
    signals: 'CXO Leadership Tracker & Verified LinkedIn Updates',
  },
  due_soon: {
    title: 'Due Soon & Follow-ups',
    icon: 'fa-solid fa-circle-check',
    badge: 'Task Management',
    summary: 'Centralized list of scheduled outreach tasks, prospect follow-ups, and CRM action items due within the next 7 days.',
    actionTip: 'Review daily to maintain deal momentum and ensure no client commitments or follow-ups slip through the cracks. Click "View all" for full task queue.',
    signals: 'Internal Task Console & CRM Sync',
  },
  hiring: {
    title: 'Hiring Signals',
    icon: 'fa-solid fa-briefcase',
    badge: 'Talent & Capacity Demand',
    summary: 'Tracks open requisitions, leadership hiring, contractor demand, and active tech hubs queried directly from PostgreSQL.',
    actionTip: 'Surges in technical roles or contract flags indicate funded initiatives. Expand the "Live Requisitions Browser" to view live postings.',
    signals: 'Greenhouse, Lever & LinkedIn Job Scrapers',
  },
  strategic_tracks: {
    title: 'Strategic Investment Tracks',
    icon: 'fa-solid fa-sitemap',
    badge: 'Enterprise Alignment',
    summary: 'Translates technical hiring clusters into major enterprise investment tracks (AI Hub, Cloud Modernization) mapped directly to sponsoring C-Suite & VP leaders.',
    actionTip: 'Align your sales pitch with the target sponsor and recommended pitch play to address their specific department budget priorities.',
    signals: 'SEC 10-K Disclosures & Executive Spends',
  },
  capital: {
    title: 'Capital Events',
    icon: 'fa-solid fa-coins',
    badge: 'Liquidity & Budget Triggers',
    summary: 'Monitors funding rounds, acquisitions, IPO announcements, and corporate restructuring across target accounts over the last 12 months.',
    actionTip: 'Capital events unlock fresh IT budget and create post-merger integration needs—prime windows for enterprise digital transformation pitches.',
    signals: 'SEC EDGAR, Finnhub & Crunchbase',
  },
  coverage: {
    title: 'Org Coverage Gaps',
    icon: 'fa-solid fa-user-xmark',
    badge: 'Relationship Risk',
    summary: 'Audits relationship health across departments to highlight single-threaded accounts and unmapped decision makers.',
    actionTip: 'Multi-thread into accounts by identifying and prospecting missing committee roles before single-point-of-contact deals stall.',
    signals: 'Diffbot Knowledge Graph & Persona Mapping',
  },
  pain_points: {
    title: 'Top Pain Points',
    icon: 'fa-solid fa-fire-flame-curved',
    badge: 'Discovery & Needs',
    summary: 'Ranks the operational and technical pain points most frequently voiced by decision-makers across your target accounts.',
    actionTip: 'Lead discovery conversations and email openers by directly referencing the #1 operational pain point to establish instant relevance.',
    signals: 'AI Persona Dossiers & Discovery Interviews',
  },
  objections: {
    title: 'Key Objections',
    icon: 'fa-solid fa-shield-halved',
    badge: 'Objection Handling',
    summary: 'Ranks the common procurement, technical, and budget objections encountered across buying personas.',
    actionTip: 'Pre-empt top objections before the prospect raises them by weaving battlecard counter-arguments into your proposal and pitch decks.',
    signals: 'AI Persona Dossiers & Field Interviews',
  },
  news: {
    title: 'Google News',
    icon: 'fa-solid fa-newspaper',
    badge: 'Public Coverage',
    summary: 'Recent Google News coverage already captured in the database for your accounts — earnings, leadership, market moves, and general press.',
    actionTip: 'Reference a specific, recent headline in outreach — it signals you\'re paying attention to their business, not sending a generic template.',
    signals: 'Google News RSS & Public Press Wire',
  },
};

/**
 * Initializes the widget info modal and binds click handlers to all ? buttons.
 */
export function initWidgetGuides() {
  const modal = document.getElementById('ccWidgetInfoModal');
  const backdrop = document.getElementById('ccWidgetInfoBackdrop');
  const closeBtn = document.getElementById('ccWidgetInfoClose');
  const titleEl = document.getElementById('ccWidgetInfoTitle');
  const iconEl = document.getElementById('ccWidgetInfoIcon');
  const badgeEl = document.getElementById('ccWidgetInfoBadge');
  const summaryEl = document.getElementById('ccWidgetInfoSummary');
  const actionEl = document.getElementById('ccWidgetInfoAction');
  const signalsEl = document.getElementById('ccWidgetInfoSignals');

  function openGuide(key) {
    const guide = WIDGET_GUIDES[key];
    if (!guide || !modal) return;

    if (titleEl) titleEl.textContent = guide.title;
    if (iconEl) iconEl.className = `${guide.icon || 'fa-solid fa-circle-info'}`;
    if (badgeEl) badgeEl.textContent = guide.badge || 'Sales Intelligence';
    if (summaryEl) summaryEl.textContent = guide.summary;
    if (actionEl) actionEl.textContent = guide.actionTip;
    if (signalsEl) signalsEl.textContent = guide.signals || 'Real-time telemetry';

    modal.classList.add('active');
    if (backdrop) backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeGuide() {
    if (modal) modal.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Bind all ? buttons in the dashboard
  document.querySelectorAll('[data-widget-info]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.getAttribute('data-widget-info');
      openGuide(key);
    });
  });

  closeBtn?.addEventListener('click', closeGuide);
  backdrop?.addEventListener('click', closeGuide);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) {
      closeGuide();
    }
  });
}
