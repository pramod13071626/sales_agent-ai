// Resolves a Command Center mock account (by name) to a real accounts.id in
// the database, so "Create task" / "Push to CRM" can write a real ActionItem
// rather than simulate one. Loaded once and shared (accounts-nav.js reuses
// the same fetch for the sidebar so the page only hits /api/accounts once).
let accountsPromise = null;

export function loadRealAccounts() {
  if (!accountsPromise) {
    accountsPromise = fetch('/api/accounts')
      .then(res => { if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`); return res.json(); })
      .then(data => data.accounts || []);
  }
  return accountsPromise;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/\b(the|corporation|corp|inc|llc|ltd|company|co)\b/g, '').replace(/[^a-z0-9]+/g, '');
}

/** Returns the matching real account ({id, name, ...}) or null if this user
 * has no visible account whose name resembles the given mock account name —
 * either it isn't in the database, or a super_admin hasn't granted this user
 * access to it yet. */
export async function resolveRealAccount(mockAccountName) {
  const accounts = await loadRealAccounts();
  const target = normalize(mockAccountName);
  if (!target) return null;
  return accounts.find(a => {
    const n = normalize(a.name);
    return n === target || n.includes(target) || target.includes(n);
  }) || null;
}

// ── Real accounts shaped for the Priority Matrix / KPI strip ──────────────
// heat_score is a genuine composite score already computed server-side.
// signalStrength and engagementRecency have no single matching DB column, so
// they're derived from the closest real fields available (90-day trend, and
// how recently this account's intelligence was last refreshed) rather than
// invented outright. dealPotential has NO real backing field anywhere in the
// schema (no deals/pipeline table exists) — it's a clearly-flagged estimate
// from heat_score + contacts mapped, used only to size matrix bubbles.

function normalizeTrendScore(t) {
  // trend_score_90d is roughly -100..100 (see signals.js renderEngagementPanel).
  return Math.max(0, Math.min(100, (t + 100) / 2));
}

function recencyScore(extractedAtIso) {
  if (!extractedAtIso) return 40; // unknown recency — mid-low default, not zero
  const days = (Date.now() - new Date(extractedAtIso).getTime()) / 86400000;
  return Math.max(0, Math.min(100, 100 - days * (100 / 180))); // decays to 0 over ~180 days
}

function estimateDealPotential(a) {
  const base = 400000; // enterprise-deal floor
  const scoreFactor = 1 + (a.heat_score || 0) / 100 * 2.5; // up to 3.5x at heat_score 100
  const contactsFactor = 1 + Math.min(a.total_contacts_captured || 0, 50) / 50; // up to 2x at 50+ contacts mapped
  return Math.round((base * scoreFactor * contactsFactor) / 50000) * 50000; // round to nearest $50K
}

let matrixAccountsPromise = null;

export function loadMatrixAccounts() {
  if (!matrixAccountsPromise) {
    matrixAccountsPromise = loadRealAccounts().then(raw => raw.map(a => ({
      id: a.id,
      key: a.key,
      name: a.name,
      ticker: a.ticker || a.stock_symbol || '',
      compositeScore: a.heat_score ?? 0,
      signalStrength: a.trend_score_90d != null ? normalizeTrendScore(a.trend_score_90d) : (a.heat_score ?? 0),
      engagementRecency: recencyScore(a.extracted_at),
      dealPotential: estimateDealPotential(a),
      dealPotentialEstimated: true,
    })));
  }
  return matrixAccountsPromise;
}
