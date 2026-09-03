// Single shared mutable state object. Every module imports `{ state }` and reads/writes
// through it (state.accounts, state.activeAccountId, ...) instead of closing over
// separate top-level variables the way the original monolithic dashboard.js did.
//
// A plain object was chosen over per-field getter/setter functions because many call
// sites do compound mutation that doesn't map cleanly onto setters — `state.
// expandedAccountIds.add(id)`, `state.activeJobPage++`, `state.extraTech[id] = [...]`.
// This keeps identical semantics to the original shared closure, just import-able.

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

export function saveDigestSectionVisibility() {
  try {
    localStorage.setItem('dash_digest_section_visibility', JSON.stringify(state.digestSectionVisibility));
  } catch (e) {
    console.warn('Could not save digest section visibility to localStorage', e);
  }
}

export const state = {
  accounts: [],
  expandedAccountIds: new Set(),
  activeAccountId: null,
  activeView: null, // null | 'allJobs' — a full-page view independent of the account/digest split
  activeLobId: null,
  activeSalesTab: 'briefing', // 'briefing' | 'committee' | 'alerts' | 'financials' | 'social' | 'weekly' | 'jobs'
  navFilter: 'all', // 'all' | 'high_score' | 'signal_ready' | 'deep_org' | 'multi_lob'
  navSort: 'score', // 'score' | 'name' | 'contacts' | 'recent'
  extraTech: {}, // accountId -> [] technologies fetched live via Diffbot, not persisted
  currentPersonas: [], // personas currently rendered in the right panel, indexed for the drawer
  currentSignals: [], // Account Signals currently rendered in the center panel, indexed for the modal
  allAccountPersonas: [], // unfiltered persona list for the currently rendered right panel, for search
  contentStore: { digests: {}, posts: {}, jobs: {} }, // real scraped posts, LLM digests + LinkedIn job postings, keyed by target_key
  opportunityHistory: {}, // accountId -> { growth_theme: [signal...], domain_expansion: [signal...] }, synced from the backend
  weeklyUpdateHistory: {}, // accountId -> [weekly update snapshot...] newest first, synced from the backend
  allJobsCache: null, // latest page response from GET /api/linkedin-jobs — server-side filtered/sorted/paginated, refetched whenever a filter or page changes
  activeJobCategory: 'All',
  activeJobSearch: '',
  activeJobEmploymentType: '',
  activeJobWorkplaceType: '',
  activeJobSort: 'newest',
  activeJobPage: 1,
  jobsLoading: false,
  jobSearchDebounceTimer: null,
  activeJobDetailId: null, // set when a job card is opened on the All Jobs page — shows an in-page detail view instead of a modal
  jobDetailCache: {}, // job id -> full detail (incl. description), fetched on demand from GET /api/linkedin-jobs/{id}
  digestSectionVisibility: loadDigestSectionVisibility(),
};
