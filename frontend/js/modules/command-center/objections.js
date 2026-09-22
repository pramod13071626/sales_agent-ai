// Operational Pain Points & Common Objections widgets
// - Operational Pain Points: Severity Tiered Grouping (Linear / Stripe Style Matrix)
// - Common Objections: Category Tag List (Simplest & Cleanest)

import { esc } from './utils.js';
import { renderSkeleton } from '../skeleton.js';

let objectionsPromise = null;

function loadObjectionsData() {
  if (!objectionsPromise) {
    objectionsPromise = fetch('/api/objections?limit=8')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load objections (${res.status})`);
        return res.json();
      });
  }
  return objectionsPromise;
}

function getViewUrl(item) {
  const accounts = item.accounts || [];
  const personas = item.personas || [];
  const topAccount = accounts[0] || (personas[0] && personas[0].account) || '';
  if (topAccount) {
    return `/?account_key=${encodeURIComponent(topAccount)}&tab=personas`;
  }
  return '/?tab=personas';
}

function groupPainPointsBySeverity(items) {
  const high = [];
  const moderate = [];
  const emerging = [];

  const maxCount = Math.max(...items.map(i => i.count || 1), 1);

  items.forEach((item, idx) => {
    const count = item.count || 1;
    if (count >= 3 || (maxCount < 3 && idx === 0)) {
      high.push({ ...item, globalRank: idx + 1 });
    } else if (count === 2 || (maxCount >= 3 && count >= 2) || (maxCount < 3 && idx < 3)) {
      moderate.push({ ...item, globalRank: idx + 1 });
    } else {
      emerging.push({ ...item, globalRank: idx + 1 });
    }
  });

  return [
    {
      id: 'high',
      title: 'High Urgency',
      subtitle: 'Critical blockers across accounts',
      dotClass: 'tier-dot-high',
      badgeClass: 'tier-badge-high',
      items: high
    },
    {
      id: 'moderate',
      title: 'Moderate Friction',
      subtitle: 'Shared operational challenges',
      dotClass: 'tier-dot-med',
      badgeClass: 'tier-badge-med',
      items: moderate
    },
    {
      id: 'emerging',
      title: 'Emerging Signals',
      subtitle: 'Early detected account signals',
      dotClass: 'tier-dot-low',
      badgeClass: 'tier-badge-low',
      items: emerging
    }
  ].filter(group => group.items.length > 0);
}

function renderSeverityMatrix(items, emptyText) {
  if (!items || !items.length) {
    return `<div class="cc-drawer-empty">${esc(emptyText)}</div>`;
  }

  const groups = groupPainPointsBySeverity(items);

  return `
    <div class="cc-severity-matrix">
      ${groups.map(group => `
        <div class="cc-severity-group cc-group-${group.id}">
          
          <!-- Group Header -->
          <div class="cc-severity-group-header">
            <div class="cc-severity-group-title-wrap">
              <span class="cc-severity-dot ${group.dotClass}"></span>
              <span class="cc-severity-group-title">${esc(group.title)}</span>
              <span class="cc-severity-group-subtitle">${esc(group.subtitle)}</span>
            </div>
            <span class="cc-severity-group-count ${group.badgeClass}">
              ${group.items.length} ${group.items.length === 1 ? 'issue' : 'issues'}
            </span>
          </div>

          <!-- Group Rows -->
          <ul class="cc-severity-list">
            ${group.items.map(item => {
              const accounts = item.accounts || [];

              return `
                <li class="cc-severity-row">
                  <div class="cc-severity-row-main">
                    <span class="cc-severity-rank">#${item.globalRank}</span>
                    <span class="cc-severity-text" title="${esc(item.text)}">${esc(item.text)}</span>
                  </div>

                  <div class="cc-severity-row-meta">
                    <div class="cc-severity-accounts">
                      ${accounts.slice(0, 2).map(a => `<span class="cc-chip cc-chip-plain">${esc(a)}</span>`).join('')}
                      ${accounts.length > 2 ? `<span class="cc-chip cc-chip-plain">+${accounts.length - 2}</span>` : ''}
                    </div>

                    <a href="${getViewUrl(item)}" class="cc-view-btn" title="View details in account view">
                      View <i class="bi bi-arrow-up-right"></i>
                    </a>
                  </div>
                </li>
              `;
            }).join('')}
          </ul>

        </div>
      `).join('')}
    </div>
  `;
}

function renderCleanObjections(items, emptyText) {
  if (!items || !items.length) {
    return `<div class="cc-drawer-empty">${esc(emptyText)}</div>`;
  }
  return `
    <ul class="cc-obj-category-list">
      ${items.map(item => {
        const accounts = item.accounts || [];

        return `
          <li class="cc-obj-category-row">
            <div class="cc-obj-row-left">
              <span class="cc-obj-quote-icon"><i class="bi bi-chat-quote-fill"></i></span>
              <span class="cc-obj-quote-text" title="${esc(item.text)}">${esc(item.text)}</span>
            </div>

            <div class="cc-obj-row-right">
              <div class="cc-obj-accounts">
                ${accounts.slice(0, 2).map(a => `<span class="cc-chip cc-chip-plain">${esc(a)}</span>`).join('')}
                ${accounts.length > 2 ? `<span class="cc-chip cc-chip-plain">+${accounts.length - 2}</span>` : ''}
              </div>

              <a href="${getViewUrl(item)}" class="cc-view-btn" title="View details in account view">
                View <i class="bi bi-arrow-up-right"></i>
              </a>
            </div>
          </li>
        `;
      }).join('')}
    </ul>
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




