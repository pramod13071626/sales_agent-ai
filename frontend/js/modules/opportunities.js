// Growth-theme + domain-expansion opportunity engine. computeDomainExpansionOpportunities
// is shared by both digest.js (Global Domain Expansion) and account-tabs.js (per-account
// Domain Expansion). The growth-opportunity family (computeGrowthOpportunities and below)
// has no digest equivalent — account-only.
import { state } from './state.js';
import { el } from './dom.js';
import { CHANNEL_LABEL, STRADIT_OFFERINGS } from './constants.js';
import { esc, slugify, dedupePersonas, isDryRunDigest, resolveAccountTargetKey, resolvePersonaTargetKey } from './utils.js';

export function computeGrowthOpportunities(account) {
  const themeMap = new Map(); // theme text -> { count, channels:Set, summary, person }
  const allKeywords = STRADIT_OFFERINGS.flatMap(off => off.keywords);

  function collectFromTargetKey(targetKey, personName) {
    const d = state.contentStore.digests[targetKey];
    if (!d || isDryRunDigest(d)) return;
    (d.digest.channels || []).forEach(ch => {
      (ch.themes || []).forEach(theme => {
        if (allKeywords.some(rx => rx.test(theme))) return; // already served by an existing offering
        if (!themeMap.has(theme)) themeMap.set(theme, { count: 0, channels: new Set(), summary: ch.summary, person: personName });
        const entry = themeMap.get(theme);
        entry.count++;
        entry.channels.add(ch.channel);
      });
    });
  }

  const acctKey = resolveAccountTargetKey(account);
  if (acctKey) collectFromTargetKey(acctKey);
  (account.personas || []).forEach(p => {
    const pk = resolvePersonaTargetKey(p);
    if (pk) collectFromTargetKey(pk, p.name);
  });

  return [...themeMap.entries()]
    .map(([theme, info]) => ({ theme, signalKey: slugify(theme), ...info }))
    .sort((a, b) => b.count - a.count);
}

export function suggestGrowthProductIdea(theme) {
  return `Potential build: a scoped StradIT engagement (discovery workshop + pilot deliverable) addressing "${theme}" as a net-new custom service line for this account.`;
}

// Shared history badge + card chrome for both opportunity panels.
export function renderHistoryBadge(historyEntry) {
  if (!historyEntry) return '';
  if (historyEntry.is_new) return '<span class="pill pill-success"><i class="bi bi-stars"></i> New</span>';
  if (historyEntry.status === 'inactive') return '<span class="pill pill-muted"><i class="bi bi-clock-history"></i> No longer trending</span>';
  return '';
}

export function renderGrowthOpportunities(account, historySignals) {
  const opportunities = computeGrowthOpportunities(account);
  const historyByKey = new Map((historySignals || []).map(s => [s.signal_key, s]));
  // Merge in historical (inactive) themes not present in the live compute, so nothing detected in the past silently disappears.
  const liveKeys = new Set(opportunities.map(o => o.signalKey));
  const historicalOnly = (historySignals || [])
    .filter(s => s.status === 'inactive' && !liveKeys.has(s.signal_key))
    .map(s => ({
      theme: s.title, signalKey: s.signal_key,
      count: s.details.count || 0,
      channels: new Set(s.details.channels || []),
      summary: s.details.summary, person: s.details.person
    }));
  const combined = [...opportunities, ...historicalOnly];

  if (!combined.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-compass"></i></div>
      <div class="empty-block-text">No recurring unserved themes detected yet for this account.</div>
    </div>`;
  }
  return combined.map(o => `
    <div class="opportunity-card">
      <div class="opportunity-header">
        <i class="bi bi-compass"></i>
        <span class="opportunity-title">${esc(o.theme)}</span>
        ${o.count ? `<span class="pill pill-warning">${o.count} mention${o.count !== 1 ? 's' : ''}</span>` : ''}
        ${renderHistoryBadge(historyByKey.get(o.signalKey))}
      </div>
      <div class="opportunity-note">
        Not covered by any current StradIT service line${o.channels && o.channels.size ? ` — recurring in ${[...o.channels].map(c => esc(CHANNEL_LABEL[c] || c)).join(', ')}` : ''}${o.person ? ` (via ${esc(o.person)})` : ''}.
      </div>
      <div class="opportunity-idea"><i class="bi bi-lightbulb"></i> ${esc(suggestGrowthProductIdea(o.theme))}</div>
      ${o.summary ? `<div class="opportunity-evidence"><i class="bi bi-quote"></i> ${esc(o.summary.length > 160 ? o.summary.slice(0, 160) + '…' : o.summary)}</div>` : ''}
    </div>`).join('');
}

export function computeDomainExpansionOpportunities(account) {
  const opportunities = [];
  const personas = dedupePersonas(account.personas || []);
  const lobs = account.lobs || [];
  const techSet = new Set();
  lobs.forEach(l => (l.technologies || []).forEach(t => techSet.add(t.toLowerCase())));

  // 1. Digital Assets, Tokenization & Settlement
  const hasDigitalAssets = lobs.some(l => /nominee|investment|fund|pershing/i.test(l.name)) || personas.some(p => /market|trade|investment/i.test(p.title || ''));
  if (hasDigitalAssets) {
    const sponsor = personas.find(p => /global markets|digital|innovation|technology/i.test(p.title || '')) || personas[0];
    opportunities.push({
      id: 'tokenization',
      title: 'Institutional Tokenization & Digital Asset Custody Engine',
      domain: 'Digital Assets & Web3 Integration',
      icon: 'bi-currency-bitcoin',
      status: 'High Demand in Enterprise',
      statusClass: 'pill-brand',
      demandSignal: 'Active market shift towards tokenized institutional collateral, digital custody, and real-time ledger settlement rails.',
      synergyAngle: 'StradIT can bridge existing AI governance & secure cloud infrastructure with custom smart-contract audit & tokenized custody APIs.',
      proposedScope: 'Deliver a 6-week POC on AI-assisted transaction reconciliation and multi-signature smart-contract lifecycle compliance.',
      sponsorName: sponsor ? sponsor.name : 'Head of Global Markets / CDO',
      sponsorTitle: sponsor ? (sponsor.title || 'Executive Leader') : 'Digital Innovation Leader'
    });
  }

  // 2. Quantum-Safe Cryptography & Post-Quantum Cyber Defense
  const hasSecurityMandate = account.company_type === 'Public' || /bank|financial|mellon/i.test(account.name);
  if (hasSecurityMandate) {
    const secSponsor = personas.find(p => /security|ciso|risk|technology advisory|infrastructure/i.test(p.title || '')) || personas.find(p => (p.tier || '').toLowerCase().includes('c')) || personas[0];
    opportunities.push({
      id: 'pqc',
      title: 'Post-Quantum Cryptography (PQC) & NIST Migration Readiness',
      domain: 'Next-Gen Cyber & Zero-Trust',
      icon: 'bi-shield-check',
      status: 'Emerging Regulatory Mandate',
      statusClass: 'pill-success',
      demandSignal: 'Upcoming federal and regulatory directives requiring financial institutions to inventory cryptographic assets for quantum resistance.',
      synergyAngle: 'Leverage StradIT AI-driven static code analysis and test automation to scan enterprise repositories for deprecated cipher suites.',
      proposedScope: 'Automated cryptographic discovery scan across core service repositories and post-quantum transition roadmap definition.',
      sponsorName: secSponsor ? secSponsor.name : 'CISO / Head of Security Engineering',
      sponsorTitle: secSponsor ? (secSponsor.title || 'Chief Information Security Officer') : 'Security Engineering Lead'
    });
  }

  // 3. Intelligent Core Event-Driven Microservices Refactoring
  if (lobs.length > 2 || account.employee_count_range) {
    const appSponsor = personas.find(p => /application|engineering|scrum|project lead/i.test(p.title || '')) || personas[0];
    opportunities.push({
      id: 'core_modernization',
      title: 'Intelligent Event-Driven Microservices & Legacy Core De-Coupling',
      domain: 'Cloud Architecture & Modernization',
      icon: 'bi-diagram-3-fill',
      status: 'Active Multi-LOB Modernization',
      statusClass: 'pill-warning',
      demandSignal: 'Managing disparate operating divisions requiring decoupled real-time event streaming and zero-downtime message orchestration.',
      synergyAngle: 'Pair StradIT cloud engineering with automated AI testing pipelines to extract business rules from legacy services safely.',
      proposedScope: 'Domain-Driven Design (DDD) workshop and scaffolding of an event-driven Kafka/cloud microservices bridge for clearance modules.',
      sponsorName: appSponsor ? appSponsor.name : 'VP Lead Applications',
      sponsorTitle: appSponsor ? (appSponsor.title || 'Lead Application Manager / VP') : 'Enterprise Engineering Director'
    });
  }

  return opportunities;
}

export function renderDomainExpansionOpportunities(account, historySignals) {
  const opportunities = computeDomainExpansionOpportunities(account);
  const historyByKey = new Map((historySignals || []).map(s => [s.signal_key, s]));
  const liveKeys = new Set(opportunities.map(o => o.id));
  const historicalOnly = (historySignals || [])
    .filter(s => s.status === 'inactive' && !liveKeys.has(s.signal_key))
    .map(s => ({ id: s.signal_key, title: s.title, ...s.details }));
  const combined = [...opportunities, ...historicalOnly];

  if (!combined.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-layers"></i></div>
      <div class="empty-block-text">No custom capability expansion domains defined yet for this account.</div>
    </div>`;
  }
  return combined.map(o => `
    <div class="opportunity-card opportunity-card-brand">
      <div class="opportunity-header">
        <i class="bi ${esc(o.icon || 'bi-layers')}"></i>
        <span class="opportunity-title">${esc(o.title)}</span>
        ${o.status ? `<span class="pill ${esc(o.statusClass || 'pill-brand')}">${esc(o.status)}</span>` : ''}
        ${renderHistoryBadge(historyByKey.get(o.id))}
      </div>
      ${o.domain ? `<div class="opportunity-note"><strong>${esc(o.domain)}</strong>${o.demandSignal ? ` — ${esc(o.demandSignal)}` : ''}</div>` : ''}
      ${o.proposedScope ? `<div class="opportunity-idea"><i class="bi bi-lightbulb"></i> <strong>Suggested build:</strong> ${esc(o.proposedScope)}</div>` : ''}
      ${o.synergyAngle ? `<div class="opportunity-evidence"><i class="bi bi-quote"></i> ${esc(o.synergyAngle)}</div>` : ''}
      ${o.sponsorName ? `<div class="opportunity-sponsor"><i class="bi bi-person-badge"></i> Likely sponsor: ${esc(o.sponsorName)}${o.sponsorTitle ? ` — ${esc(o.sponsorTitle)}` : ''}</div>` : ''}
    </div>`).join('');
}

// Persists the currently-computed growth-theme & domain-expansion suggestions for an account so
// they accumulate as history server-side, then repaints the two panels with new/historical badges.
export async function syncOpportunitySignals(account) {
  const growthItems = computeGrowthOpportunities(account).map(o => ({
    signal_key: o.signalKey,
    title: o.theme,
    details: { count: o.count, channels: [...o.channels], summary: o.summary, person: o.person }
  }));
  const domainItems = computeDomainExpansionOpportunities(account).map(o => ({
    signal_key: o.id,
    title: o.title,
    details: o
  }));
  let growthData = null, domainData = null;
  try {
    const [growthRes, domainRes] = await Promise.all([
      fetch(`/api/accounts/${account.id}/opportunities/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'growth_theme', items: growthItems })
      }),
      fetch(`/api/accounts/${account.id}/opportunities/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'domain_expansion', items: domainItems })
      })
    ]);
    if (growthRes.ok) growthData = await growthRes.json();
    if (domainRes.ok) domainData = await domainRes.json();
  } catch (err) {
    console.error('Opportunity signal sync failed', err);
    return;
  }
  state.opportunityHistory[account.id] = {
    growth_theme: growthData ? growthData.signals : [],
    domain_expansion: domainData ? domainData.signals : []
  };
  if (state.activeAccountId === account.id && state.activeSalesTab === 'alerts') {
    const growthBody = el('growthOpportunitiesBody');
    const domainBody = el('domainExpansionBody');
    if (growthBody) growthBody.innerHTML = renderGrowthOpportunities(account, state.opportunityHistory[account.id].growth_theme);
    if (domainBody) domainBody.innerHTML = renderDomainExpansionOpportunities(account, state.opportunityHistory[account.id].domain_expansion);
  }
}
