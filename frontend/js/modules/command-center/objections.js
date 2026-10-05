// Operational Pain Points & Common Objections Widgets (Complete Visibility & Professional Card Layout)
// Real data from /api/objections
import { esc } from './utils.js';
import { renderSkeleton } from '../skeleton.js';

let objectionsPromise = null;

export function loadObjectionsData() {
  if (!objectionsPromise) {
    objectionsPromise = fetch('/api/objections')
      .then(res => res.ok ? res : fetch('/api/command-center/objections'))
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load objections: ${res.status}`);
        return res.json();
      });
  }
  return objectionsPromise;
}

function getAccountList(item) {
  const personas = item.personas || [];
  const accountMap = new Map();

  personas.forEach(p => {
    if (p.account && !accountMap.has(p.account)) {
      let profileUrl = '';
      if (p.account_id && p.id) {
        profileUrl = `/profile?account=${encodeURIComponent(p.account_id)}&persona_id=${encodeURIComponent(p.id)}`;
      } else if (p.account_id) {
        profileUrl = `/?account=${encodeURIComponent(p.account_id)}&tab=personas`;
      } else {
        profileUrl = `/?account_key=${encodeURIComponent(p.account)}&tab=personas`;
      }

      accountMap.set(p.account, {
        name: p.account,
        accountId: p.account_id,
        personaId: p.id,
        personaName: p.name || 'Executive',
        url: profileUrl,
      });
    }
  });

  (item.accounts || []).forEach(name => {
    if (!accountMap.has(name)) {
      accountMap.set(name, {
        name: name,
        accountId: null,
        personaId: null,
        personaName: 'Executive',
        url: `/?account_key=${encodeURIComponent(name)}&tab=personas`,
      });
    }
  });

  return Array.from(accountMap.values());
}

function renderSeverityMatrix(items, emptyText) {
  if (!items || !items.length) {
    return `<div class="cc-drawer-empty">${esc(emptyText)}</div>`;
  }

  return `
    <div class="cc-compact-scroll-wrap">
      <ul class="cc-compact-list">
        ${items.slice(0, 10).map((item, idx) => {
          const accountList = getAccountList(item);
          const count = item.count || 1;
          const severity = count >= 300 ? 'high' : count >= 50 ? 'med' : 'low';
          const severityLabel = severity === 'high' ? 'High Impact' : severity === 'med' ? 'Medium Impact' : 'Active Signal';

          return `
            <li class="cc-objection-card">
              <div class="cc-card-header-row">
                <div class="cc-card-title-group">
                  <span class="cc-severity-dot tier-dot-${severity}" title="${severityLabel} (${count} mentions)"></span>
                  <span class="cc-compact-rank">#${idx + 1}</span>
                  <span class="cc-card-full-text">${esc(item.text)}</span>
                </div>
                <span class="cc-chip cc-chip-xs ${severity === 'high' ? 'cc-chip-danger' : severity === 'med' ? 'cc-chip-warning' : 'cc-chip-plain'}">${count} mentions</span>
              </div>
              <div class="cc-card-accounts-row">
                <span class="cc-accounts-lead"><i class="fa-regular fa-building"></i> Target Accounts:</span>
                <div class="cc-accounts-pill-list">
                  ${accountList.map(acc => `
                    <a href="${acc.url}" class="cc-account-view-pill" title="View Executive Profile Dossier at ${esc(acc.name)}">
                      <span class="cc-acc-name">${esc(acc.name)}</span>
                      <span class="cc-acc-view-btn">View <i class="fa-solid fa-arrow-up-right-from-square"></i></span>
                    </a>
                  `).join('')}
                </div>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `;
}

function renderCleanObjections(items, emptyText) {
  if (!items || !items.length) {
    return `<div class="cc-drawer-empty">${esc(emptyText)}</div>`;
  }

  return `
    <div class="cc-compact-scroll-wrap">
      <ul class="cc-compact-list">
        ${items.slice(0, 10).map((item, idx) => {
          const accountList = getAccountList(item);
          const count = item.count || 1;

          return `
            <li class="cc-objection-card">
              <div class="cc-card-header-row">
                <div class="cc-card-title-group">
                  <span class="cc-compact-quote-icon"><i class="fa-solid fa-quote-left"></i></span>
                  <span class="cc-compact-rank">#${idx + 1}</span>
                  <span class="cc-card-full-text">${esc(item.text)}</span>
                </div>
                ${count > 1 ? `<span class="cc-chip cc-chip-xs cc-chip-plain">${count} mentions</span>` : ''}
              </div>
              <div class="cc-card-accounts-row">
                <span class="cc-accounts-lead"><i class="fa-regular fa-building"></i> Target Accounts:</span>
                <div class="cc-accounts-pill-list">
                  ${accountList.map(acc => `
                    <a href="${acc.url}" class="cc-account-view-pill" title="View Executive Profile Dossier at ${esc(acc.name)}">
                      <span class="cc-acc-name">${esc(acc.name)}</span>
                      <span class="cc-acc-view-btn">View <i class="fa-solid fa-arrow-up-right-from-square"></i></span>
                    </a>
                  `).join('')}
                </div>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `;
}

export async function renderObjections() {
  const painPointsBody = document.getElementById('ccPainPointsBody');
  const objectionsBody = document.getElementById('ccObjectionsBody');

  if (painPointsBody) painPointsBody.innerHTML = renderSkeleton('lines');
  if (objectionsBody) objectionsBody.innerHTML = renderSkeleton('lines');

  let data;
  try {
    data = await loadObjectionsData();
  } catch (err) {
    console.error('Failed to load objections & pain points data:', err);
    if (painPointsBody) painPointsBody.innerHTML = '<div class="cc-drawer-empty">Could not load pain points data.</div>';
    if (objectionsBody) objectionsBody.innerHTML = '<div class="cc-drawer-empty">Could not load objections data.</div>';
    return;
  }

  if (painPointsBody) {
    painPointsBody.innerHTML = renderSeverityMatrix(data.pain_points || [], 'No pain points captured yet for your accounts.');
  }
  if (objectionsBody) {
    objectionsBody.innerHTML = renderCleanObjections(data.objections || [], 'No objections captured yet for your accounts.');
  }
}
