// Mock seed data for the Sales Command Center. Shapes mirror the interfaces below
// (documented via JSDoc rather than TypeScript — this app's frontend is plain ES
// modules, no build step, no TS/JSX; see MEMORY / project conventions).
//
// @typedef {Object} Account
// @property {string} id
// @property {string} name
// @property {string} ticker
// @property {number} compositeScore      0-100, recency x seniority x strategic fit
// @property {number} signalStrength      0-100
// @property {number} engagementRecency   0-100
// @property {number} dealPotential       USD
//
// @typedef {Object} Signal
// @property {string} id
// @property {string} accountId
// @property {"AI"|"Digital assets"|"Cloud"|"Cyber"} domain
// @property {string} title
// @property {number} score
// @property {number} signalCount
// @property {string} summary             one-line "why it matters"
// @property {Date} detectedAt
//
// @typedef {Object} ExecChange
// @property {string} person
// @property {string} role
// @property {"joined"|"resigned"|"promoted"} type
// @property {string} company
// @property {Date} date
// @property {boolean} actioned
//
// @typedef {Object} PlaybookAction
// @property {number} rank
// @property {string} title
// @property {string} rationale
// @property {"high"|"medium"} impact
// @property {string} accountId
// @property {boolean} crmSynced

function hoursAgo(h) { return new Date(Date.now() - h * 3600 * 1000); }
function daysAgo(d) { return hoursAgo(d * 24); }

/** @type {Account[]} */
export const accounts = [
  { id: 'bny', name: 'BNY Mellon', ticker: 'BK', compositeScore: 94, signalStrength: 92, engagementRecency: 88, dealPotential: 2400000 },
  { id: 'ntrs', name: 'Northern Trust', ticker: 'NTRS', compositeScore: 78, signalStrength: 74, engagementRecency: 82, dealPotential: 1100000 },
  { id: 'vgd', name: 'Vanguard', ticker: 'VNGD', compositeScore: 66, signalStrength: 68, engagementRecency: 55, dealPotential: 1300000 },
  { id: 'blk', name: 'BlackRock', ticker: 'BLK', compositeScore: 55, signalStrength: 55, engagementRecency: 30, dealPotential: 900000 },
  { id: 'stt', name: 'State Street', ticker: 'STT', compositeScore: 41, signalStrength: 40, engagementRecency: 62, dealPotential: 700000 },
  { id: 'fido', name: 'Fidelity', ticker: 'FNF', compositeScore: 35, signalStrength: 35, engagementRecency: 25, dealPotential: 500000 },
];

/** @type {Signal[]} */
export const signals = [
  { id: 'sig-1', accountId: 'bny', domain: 'AI', title: 'Applied AI adoption accelerating', score: 96, signalCount: 202, summary: 'Enterprise-wide LLM pilots signal budget in motion for Q4.', detectedAt: hoursAgo(2) },
  { id: 'sig-2', accountId: 'bny', domain: 'Digital assets', title: 'Digital asset custody expansion', score: 88, signalCount: 101, summary: 'New custody licenses filed in three jurisdictions this month.', detectedAt: hoursAgo(20) },
  { id: 'sig-3', accountId: 'bny', domain: 'Cloud', title: 'Cloud modernization program', score: 74, signalCount: 69, summary: 'RFP language shifted toward multi-cloud vendor consolidation.', detectedAt: daysAgo(3.4) },
  { id: 'sig-4', accountId: 'ntrs', domain: 'Cyber', title: 'PQC readiness push', score: 70, signalCount: 34, summary: 'NIST post-quantum mandate is driving an infrastructure audit RFP.', detectedAt: daysAgo(1.2) },
  { id: 'sig-5', accountId: 'ntrs', domain: 'AI', title: 'West coast family office AI pilot', score: 62, signalCount: 18, summary: 'New family office lead is scoping an advisor copilot pilot.', detectedAt: daysAgo(2.1) },
  { id: 'sig-6', accountId: 'vgd', domain: 'Cloud', title: 'Deal stalled — no activity 14 days', score: 58, signalCount: 12, summary: 'Champion went quiet after the last proposal; renewal risk rising.', detectedAt: daysAgo(4.5) },
  { id: 'sig-7', accountId: 'blk', domain: 'Digital assets', title: 'Tokenized fund infrastructure eval', score: 53, signalCount: 21, summary: 'Vendor shortlist for tokenized fund infra is due end of month.', detectedAt: daysAgo(5.5) },
  { id: 'sig-8', accountId: 'stt', domain: 'Cyber', title: 'Vendor risk questionnaire reopened', score: 44, signalCount: 9, summary: 'Security team reopened the vendor risk review after a hiring gap.', detectedAt: daysAgo(6.2) },
  { id: 'sig-9', accountId: 'fido', domain: 'AI', title: 'Early exploratory AI budget line', score: 33, signalCount: 5, summary: 'A discretionary AI tooling line appeared in next year’s draft budget.', detectedAt: daysAgo(2.8) },
  // Older than 7 days — the feed drops this one; kept here to exercise that rule.
  { id: 'sig-10', accountId: 'bny', domain: 'AI', title: 'Automated AI testing pilot', score: 22, signalCount: 7, summary: 'Small internal QA pilot, low signal density, unlikely to progress.', detectedAt: daysAgo(9) },
];

/** @type {ExecChange[]} */
export const execChanges = [
  { person: 'Candice Nakagawa', role: 'West Family Office Lead', type: 'joined', company: 'Northern Trust', date: daysAgo(6), actioned: true },
  { person: 'Beata Kirr', role: 'CIO, Global Family Office', type: 'joined', company: 'BNY Mellon', date: daysAgo(11), actioned: true },
  { person: 'BNY TAM Lead', role: 'Regional TAM Lead', type: 'promoted', company: 'BNY Mellon', date: daysAgo(24), actioned: false },
];

/** @type {PlaybookAction[]} */
export const playbookActions = [
  { rank: 1, title: 'Schedule an executive briefing on the Applied AI roadmap', rationale: 'Score 96 signal on a $2.4M account — the hottest movement this week.', impact: 'high', accountId: 'bny', crmSynced: false },
  { rank: 2, title: 'Loop in the custody solutions team on the Digital Asset Custody RFP', rationale: 'Score 88 signal; licenses filed in three jurisdictions this month.', impact: 'high', accountId: 'bny', crmSynced: false },
  { rank: 3, title: 'Send a welcome outreach to Candice Nakagawa', rationale: 'New West Family Office lead, exec change 6 days old — window closing.', impact: 'high', accountId: 'ntrs', crmSynced: false },
  { rank: 4, title: 'Re-engage Vanguard — deal stalled 14 days', rationale: 'No logged activity in 14 days; $1.3M pipeline at risk.', impact: 'medium', accountId: 'vgd', crmSynced: false },
  { rank: 5, title: 'Confirm the new TAM contact at BNY Mellon', rationale: 'TAM lead promoted 24 days ago and still unactioned.', impact: 'medium', accountId: 'bny', crmSynced: false },
];

/** @type {KpiData} base numbers; per-role scoping is applied in kpi.js */
export const kpiBase = {
  signalVelocity: 47,
  velocityDeltaPct: 18,
  velocityTrend: [22, 25, 24, 30, 28, 35, 40, 47],
  execChangesOpen: execChanges.length,
  playsInMotion: 12,
  playsStalled: 2,
  q4CloseEstimate: 4800000,
};

export const DOMAINS = ['AI', 'Digital assets', 'Cloud', 'Cyber'];

export function accountById(id) {
  return accounts.find(a => a.id === id) || null;
}
