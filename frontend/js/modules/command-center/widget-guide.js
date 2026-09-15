/**
 * Widget Guide & Explanations for Sales Command Center
 * Provides concise, informative sales guidance on clicking the '?' button on each widget.
 */

export const WIDGET_GUIDES = {
  matrix: {
    title: 'Account Priority Matrix',
    icon: 'bi-grid-1x2-fill',
    badge: 'Prioritization & Strategy',
    summary: 'Plots monitored enterprise accounts across buying urgency (signal velocity) and deal potential (strategic value). Bubble size reflects estimated contract value.',
    actionTip: 'Focus daily prospecting on top-right quadrant accounts with high urgency and high value. Click any bubble to open the account dossier.',
    signals: 'Hiring volume, leadership hires, SEC filings, executive transitions',
  },
  priority_feed: {
    title: 'Priority Signal Feed',
    icon: 'bi-lightning-charge-fill',
    badge: 'Real-Time Intent Feed',
    summary: 'Real-time stream of high-impact buying intent triggers—such as hiring surges, executive appointments, earnings calls, and tech migrations—scored from 1 to 100.',
    actionTip: 'Filter by signal category or account, then click "Draft outreach" to generate an AI-tailored pitch referencing that exact trigger.',
    signals: 'Verified LinkedIn posts, SEC 10-K/10-Q, PR Newswire, Executive hires',
  },
  playbook: {
    title: "This Week's Playbook",
    icon: 'bi-journal-bookmark-fill',
    badge: 'Weekly Action Plan',
    summary: 'AI-synthesized, prescriptive weekly game plan highlighting the highest-leverage outreach plays across your target accounts.',
    actionTip: 'Treat this as your weekly checklist. It specifies which accounts have active buying windows and the exact pitch angle to lead with.',
    signals: 'Synthesized weekly signals, buying committee triggers, pipeline status',
  },
  timeline: {
    title: 'Executive Movements',
    icon: 'bi-clock-history',
    badge: 'Leadership Shifts',
    summary: 'Chronological timeline of leadership appointments, promotions, and departures across key buying committee personas over the last 30 days.',
    actionTip: 'Engage newly appointed executives during their first 90 days when they are evaluating new vendors and establishing modernization budgets.',
    signals: 'Executive appointments, C-suite & VP title changes, LinkedIn updates',
  },
  due_soon: {
    title: 'Due Soon & Follow-ups',
    icon: 'bi-check2-circle',
    badge: 'Task Management',
    summary: 'Centralized list of scheduled outreach tasks, prospect follow-ups, and CRM action items due within the next 7 days.',
    actionTip: 'Review daily to maintain deal momentum and ensure no client commitments or follow-ups slip through the cracks. Click "View all" for full task queue.',
    signals: 'Scheduled touches, CRM follow-ups, cadence reminders',
  },
  hiring: {
    title: 'Hiring Signals & Requisitions',
    icon: 'bi-briefcase-fill',
    badge: 'Talent & Capacity Demand',
    summary: 'Tracks open requisitions, leadership hiring, contractor demand, and active tech hubs queried directly from PostgreSQL.',
    actionTip: 'Surges in technical roles or contract flags indicate funded initiatives. Expand the "Live Requisitions Browser" to view live postings.',
    signals: 'Live LinkedIn job requisitions, staff-aug keywords, location hubs',
  },
  strategic_tracks: {
    title: 'Strategic Investment Tracks',
    icon: 'bi-diagram-3-fill',
    badge: 'Enterprise Alignment',
    summary: 'Translates technical hiring clusters into major enterprise investment tracks (AI Hub, Cloud Modernization) mapped directly to sponsoring C-Suite & VP leaders.',
    actionTip: 'Align your sales pitch with the target sponsor and recommended pitch play to address their specific department budget priorities.',
    signals: 'Hiring cluster patterns, 320 executive personas in DB, department alignment',
  },
  capital: {
    title: 'Capital Events',
    icon: 'bi-cash-coin',
    badge: 'Liquidity & Budget Triggers',
    summary: 'Monitors funding rounds, acquisitions, IPO announcements, and corporate restructuring across target accounts over the last 12 months.',
    actionTip: 'Capital events unlock fresh IT budget and create post-merger integration needs—prime windows for enterprise digital transformation pitches.',
    signals: 'SEC filings, Crunchbase, financial press, M&A announcements',
  },
  coverage: {
    title: 'Org Coverage Gaps',
    icon: 'bi-person-x-fill',
    badge: 'Relationship Risk',
    summary: 'Audits relationship health across departments to highlight single-threaded accounts and unmapped decision makers.',
    actionTip: 'Multi-thread into accounts by identifying and prospecting missing committee roles before single-point-of-contact deals stall.',
    signals: 'Internal buying committee mapping, persona database coverage',
  },
  competitor: {
    title: 'Competitor Mentions',
    icon: 'bi-shield-shaded',
    badge: 'Competitive Intelligence',
    summary: 'Scans filings, news, and job requirements for mentions of incumbent vendors and competing software or consulting firms.',
    actionTip: 'Identify upcoming contract renewal windows and vendor dissatisfaction cues to position competitive displacement strategies.',
    signals: 'Earnings call transcripts, RFPs, required tech certifications in job ads',
  },
  tech_signals: {
    title: 'Tech & IP Signals',
    icon: 'bi-cpu-fill',
    badge: 'Architecture & Patents',
    summary: 'Tracks patent filings, tech stack changes, framework modernizations, and cloud infrastructure investments.',
    actionTip: 'Cite specific technologies and architectural initiatives in your outreach to build immediate technical credibility with engineering leaders.',
    signals: 'Patent databases, tech stack disclosures, GitHub/open-source repos',
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
    if (iconEl) iconEl.className = `bi ${guide.icon || 'bi-info-circle-fill'}`;
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
