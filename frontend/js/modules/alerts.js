// Shared StradIT-offering-match engine and its rendering. Used by both digest.js
// (Global Sales Alerts, cross-account) and account-tabs.js (per-account Sales Alerts
// tab) — kept here, imported by both, so neither has to import the other.
import { state } from './state.js';
import { dashContent, dashEmpty } from './dom.js';
import { CHANNEL_LABEL, STRADIT_OFFERINGS } from './constants.js';
import { esc, dedupePersonas, findPersonaLob, tierLabel, isDryRunDigest, resolveAccountTargetKey, resolvePersonaTargetKey } from './utils.js';
import { openContactDrawer } from './contact-drawer.js';

export function buildHierarchyGroups(personas) {
  const TIER_ORDER = ['C-Suite', 'VP', 'Director', 'Manager'];
  const groups = {};
  personas.forEach(p => { const label = tierLabel(p); (groups[label] = groups[label] || []).push(p); });
  const orderedLabels = [...TIER_ORDER.filter(l => groups[l]), ...Object.keys(groups).filter(l => !TIER_ORDER.includes(l))];
  return orderedLabels.map(label => ({
    label,
    people: groups[label].sort((a, b) => (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99))
  }));
}

export function buildAlertHierarchy(account, rec) {
  let scopeName, personas, subLobs = [];
  const lobObj = rec.lob ? (account.lobs || []).find(l => l.name === rec.lob) : null;
  if (lobObj) {
    personas = dedupePersonas(lobObj.personas || []);
    subLobs = lobObj.subLobs || [];
    scopeName = lobObj.name;
  } else {
    personas = dedupePersonas(account.personas || []);
    scopeName = `${account.name} (Corporate / Group level)`;
  }
  return { scopeName, subLobs, isLob: !!lobObj, groups: buildHierarchyGroups(personas), total: personas.length, accountId: account.id };
}

export function renderAlertHierarchy(h) {
  if (!h.total) return '';
  return `
    <details class="alert-hierarchy">
      <summary>Org hierarchy — ${esc(h.scopeName)} (${h.total} contact${h.total !== 1 ? 's' : ''})</summary>
      ${h.isLob ? (h.subLobs.length
        ? `<div class="chip-row" style="margin:8px 0;">${h.subLobs.map(s => `<span class="chip"><i class="bi bi-diagram-2"></i> ${esc(s.name)}</span>`).join('')}</div>`
        : `<div class="hierarchy-note"><i class="bi bi-info-circle"></i> No sub-divisions mapped for this LOB.</div>`) : ''}
      ${h.groups.map(g => `
        <div class="hierarchy-group">
          <div class="hierarchy-group-label">${esc(g.label)} <span class="hierarchy-group-count">${g.people.length}</span></div>
          <div class="hierarchy-group-people">
            ${g.people.map(p => `<button type="button" class="hierarchy-person" title="${esc(p.title || '')} — click to view full details" data-account-id="${h.accountId}" data-persona-id="${p.id}">${esc(p.name)}</button>`).join('')}
          </div>
        </div>`).join('')}
    </details>
  `;
}

function handleHierarchyPersonClick(e) {
  const btn = e.target.closest('.hierarchy-person');
  if (!btn) return;
  const account = state.accounts.find(a => a.id === Number(btn.dataset.accountId));
  if (!account) return;
  const persona = dedupePersonas(account.personas || []).find(p => p.id === Number(btn.dataset.personaId));
  if (persona) openContactDrawer(persona);
}
dashContent.addEventListener('click', handleHierarchyPersonClick);
dashEmpty.addEventListener('click', handleHierarchyPersonClick);

export function recommendContact(offering, account, evidence) {
  const personas = dedupePersonas(account.personas || []);
  if (!personas.length) return null;

  function withLob(persona, reason) {
    const lob = findPersonaLob(account, persona);
    return { persona, reason, lob: lob ? lob.name : null };
  }

  if (evidence && evidence.person) {
    const match = personas.find(p => p.name === evidence.person);
    if (match) return withLob(match, 'Already posting about this topic');
  }

  const roleMatches = personas.filter(p => p.title && offering.roleKeywords.some(rx => rx.test(p.title)));
  if (roleMatches.length) {
    roleMatches.sort((a, b) => (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99));
    return withLob(roleMatches[0], 'Best-fit role for this service line');
  }

  const looseMatches = personas.filter(p => p.title && (offering.looseRoleKeywords || []).some(rx => rx.test(p.title)));
  if (looseMatches.length) {
    looseMatches.sort((a, b) => (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99));
    return withLob(looseMatches[0], 'Loosely related role — no dedicated specialist found');
  }

  const bySeniority = [...personas].sort((a, b) => {
    const aC = (a.tier || '').toLowerCase().includes('c-suite') || (a.tier || '').toLowerCase() === 'c_suite' ? 0 : 1;
    const bC = (b.tier || '').toLowerCase().includes('c-suite') || (b.tier || '').toLowerCase() === 'c_suite' ? 0 : 1;
    if (aC !== bC) return aC - bC;
    return (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99);
  });
  return withLob(bySeniority[0], 'No specialist mapped yet — start at the top of the org');
}

export function buildContentEntries(targetKey) {
  const entries = [];
  const d = state.contentStore.digests[targetKey];
  if (d && !isDryRunDigest(d)) {
    (d.digest.channels || []).forEach(ch => {
      if (ch.summary) entries.push({ text: ch.summary, channel: ch.channel });
      (ch.themes || []).forEach(t => entries.push({ text: t, channel: ch.channel }));
      (ch.observed || []).forEach(o => entries.push({ text: o.fact, url: o.source_url, channel: ch.channel }));
      if (ch.sales_angle) entries.push({ text: ch.sales_angle, channel: ch.channel });
      if (ch.interpretation) entries.push({ text: ch.interpretation, channel: ch.channel });
    });
  }
  (state.contentStore.posts[targetKey] || []).forEach(p => {
    if (p.body) entries.push({ text: p.body, url: p.post_url, channel: p.channel });
  });
  return entries;
}

export function getAccountContentEntries(account) {
  let entries = [];
  const acctKey = resolveAccountTargetKey(account);
  if (acctKey) entries = entries.concat(buildContentEntries(acctKey));
  (account.personas || []).forEach(p => {
    const pk = resolvePersonaTargetKey(p);
    if (pk) entries = entries.concat(buildContentEntries(pk).map(e => ({ ...e, person: p.name })));
  });
  return entries;
}

export function matchOfferings(entries) {
  const matches = [];
  STRADIT_OFFERINGS.forEach(off => {
    let hitCount = 0;
    let evidence = null;
    entries.forEach(e => {
      if (off.keywords.some(rx => rx.test(e.text))) {
        hitCount++;
        if (!evidence) evidence = e;
      }
    });
    if (hitCount > 0) matches.push({ ...off, hitCount, evidence });
  });
  return matches.sort((a, b) => b.hitCount - a.hitCount);
}

export function renderAlertCards(matches, opts) {
  opts = opts || {};
  if (!matches.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-bell-slash"></i></div>
      <div class="empty-block-text">${esc(opts.emptyText || "Captured content doesn't reference any StradIT service line yet.")}</div>
    </div>`;
  }
  return matches.map(m => {
    const ev = m.evidence;
    const snippet = ev.text.length > 180 ? ev.text.slice(0, 180) + '…' : ev.text;
    const evMeta = [ev.account, ev.person, ev.channel ? (CHANNEL_LABEL[ev.channel] || ev.channel) : null].filter(Boolean).join(' · ');
    const accountCount = m.accountIds ? new Set(m.accountIds).size : null;
    const matchAccount = opts.getAccount ? opts.getAccount(m) : null;
    const rec = matchAccount ? recommendContact(m, matchAccount, ev) : null;

    return `
      <div class="alert-card">
        <div class="alert-header">
          <i class="bi ${m.icon}"></i>
          <span class="alert-title">${esc(m.label)} opportunity</span>
          ${accountCount ? `<span class="pill">${accountCount} account${accountCount !== 1 ? 's' : ''}</span>` : ''}
          <span class="pill pill-brand">${m.hitCount} signal${m.hitCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="alert-pitch">${esc(m.pitch)}</div>
        <div class="alert-evidence">
          <i class="bi bi-quote"></i> ${esc(snippet)}
          ${evMeta ? `<span class="alert-evidence-meta">— ${esc(evMeta)}</span>` : ''}
          ${ev.url ? `<a href="${esc(ev.url)}" target="_blank"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
        </div>
        ${rec ? renderAlertHierarchy(buildAlertHierarchy(matchAccount, rec)) : (matchAccount ? `
          <div class="alert-contact alert-contact-empty">
            <i class="bi bi-person-x"></i> No contacts mapped for ${esc(matchAccount.name)} yet — fetch personas in the Account Explorer first.
          </div>` : '')}
        ${ev.accountId != null ? `<button type="button" class="alert-view-account" data-jump-account="${ev.accountId}">Open ${esc(ev.account || 'account')} <i class="bi bi-arrow-right"></i></button>` : ''}
      </div>`;
  }).join('');
}
