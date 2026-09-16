// Common Objections & Pain Points widget — ranks Persona.operational_pain_points
// and Persona.key_objections (real AI-dossier fields, not fabricated) by how
// many personas across the user's accounts mention them. Aggregation happens
// server-side (GET /api/objections) rather than shipping every persona's raw
// fields to the client just to count them here.
import { esc } from './utils.js';
import { renderSkeleton } from '../skeleton.js';

let objectionsPromise = null;

function loadObjectionsData() {
  if (!objectionsPromise) {
    objectionsPromise = fetch('/api/objections?limit=6')
      .then(res => { if (!res.ok) throw new Error(`Failed to load objections (${res.status})`); return res.json(); });
  }
  return objectionsPromise;
}

function groupHtml(title, items, emptyText) {
  if (!items.length) {
    return `
      <div class="cc-objections-group">
        <div class="cc-subhead">${esc(title)}</div>
        <div class="cc-drawer-empty">${esc(emptyText)}</div>
      </div>`;
  }
  return `
    <div class="cc-objections-group">
      <div class="cc-subhead">${esc(title)}</div>
      <ul class="cc-feed-list cc-objections-list">
        ${items.map(item => `
          <li class="cc-feed-row">
            <div class="cc-feed-body">
              <div class="cc-feed-title-row"><span class="cc-feed-title">${esc(item.text)}</span></div>
              <div class="cc-chip-row">
                ${item.accounts.slice(0, 3).map(a => `<span class="cc-chip cc-chip-plain">${esc(a)}</span>`).join('')}
                ${item.accounts.length > 3 ? `<span class="cc-chip cc-chip-plain">+${item.accounts.length - 3} more</span>` : ''}
              </div>
            </div>
            <div class="cc-feed-count">${item.count}</div>
          </li>`).join('')}
      </ul>
    </div>`;
}

export async function renderObjections() {
  const body = document.getElementById('ccObjectionsBody');
  if (!body) return;
  body.innerHTML = renderSkeleton('lines');

  let data;
  try {
    data = await loadObjectionsData();
  } catch (err) {
    console.error(err);
    body.innerHTML = '<div class="cc-drawer-empty">Could not load objections data.</div>';
    return;
  }

  body.innerHTML =
    groupHtml('Top pain points', data.pain_points || [], 'No pain points captured yet for your accounts.') +
    groupHtml('Top objections', data.objections || [], 'No objections captured yet for your accounts.');
}
