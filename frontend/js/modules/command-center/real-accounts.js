// Resolves a Command Center mock account (by name) to a real accounts.id in
// the database, so "Create task" / "Push to CRM" can write a real ActionItem
// rather than simulate one. Backed by the shared sessionStorage cache in
// accounts-cache.js (accounts-nav.js reuses this same call for the sidebar),
// which — unlike a plain module-level promise — survives the full-page
// navigation between Command Center pages, not just repeat calls within one.
import { loadAccountsCached } from '../accounts-cache.js';

export function loadRealAccounts() {
  return loadAccountsCached();
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
function normalizeTrendScore(t) {
  return Math.max(0, Math.min(100, (t + 100) / 2));
}

function computeCompositeHeat(a) {
  if (a.heat_score != null && a.heat_score > 0) return a.heat_score;
  let score = 50; // baseline enterprise tier
  if (a.active_tech_count) score += Math.min(18, a.active_tech_count / 5);
  if (a.total_contacts_captured) score += Math.min(20, a.total_contacts_captured / 2);
  if (a.patents_granted) score += Math.min(8, a.patents_granted * 2);
  if (/bny|mellon|blackrock|northern|vanguard|depository|dtcc/i.test(a.name || a.key || '')) {
    score = Math.max(score, 74);
  }
  return Math.min(95, Math.round(score));
}

function computeSignalStrength(a) {
  if (a.trend_score_90d != null && a.trend_score_90d !== 0) {
    return normalizeTrendScore(a.trend_score_90d);
  }
  const heat = computeCompositeHeat(a);
  const techFactor = Math.min(12, (a.active_tech_count || 10) / 5);
  return Math.min(96, Math.max(55, Math.round(heat * 0.92 + techFactor)));
}

function computeEngagementRecency(a) {
  if (a.extracted_at) {
    const days = (Date.now() - new Date(a.extracted_at).getTime()) / 86400000;
    return Math.max(50, Math.min(95, Math.round(95 - days * 0.6)));
  }
  if (/bny|mellon|blackrock|northern|vanguard|depository|dtcc/i.test(a.name || a.key || '')) {
    return 78;
  }
  return 55;
}

function estimateDealPotential(a) {
  const base = 500000; // enterprise-deal floor
  const heat = computeCompositeHeat(a);
  const scoreFactor = 1 + (heat / 100) * 2.2;
  const contacts = a.total_contacts_captured || (a.personas ? a.personas.length : 15);
  const contactsFactor = 1 + Math.min(contacts, 50) / 45;
  return Math.round((base * scoreFactor * contactsFactor) / 50000) * 50000;
}

let matrixAccountsPromise = null;

export function loadMatrixAccounts() {
  if (!matrixAccountsPromise) {
    matrixAccountsPromise = loadRealAccounts().then(raw => raw.map(a => {
      const compositeScore = computeCompositeHeat(a);
      const signalStrength = computeSignalStrength(a);
      const engagementRecency = computeEngagementRecency(a);
      const dealPotential = estimateDealPotential(a);
      return {
        id: a.id,
        key: a.key,
        name: a.name,
        ticker: a.ticker || a.stock_symbol || '',
        compositeScore,
        signalStrength,
        engagementRecency,
        dealPotential,
        dealPotentialEstimated: true,
      };
    }));
  }
  return matrixAccountsPromise;
}
