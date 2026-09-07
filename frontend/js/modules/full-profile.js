// Full-page contact profile — the "View Profile" destination opened from the
// contact drawer (contact-drawer.js). Unlike the drawer (a narrow sliding
// sidebar, capped at 6 posts to fit), this page has the full viewport to
// work with: every section is its own widget/panel, and Recent Social Media
// Activity shows every captured post, not a preview slice.
import { state } from './state.js';
import { esc, initials, resolvePersonaTargetKey } from './utils.js';
import {
  hasDossier,
  renderDossier,
  renderPersonaContentSummary,
  renderAllPostsByChannel,
  renderPersonalityProfile
} from './profile-render.js';

function renderHero(p) {
  const tag = p.tier || p.decision_authority || (p.departments && p.departments[0]) || null;
  const dossierReady = hasDossier(p);
  return `
    <div class="panel profile-hero">
      <div class="drawer-contact-header">
        <div class="drawer-avatar profile-avatar-lg">${esc(initials(p.name))}</div>
        <div>
          <div class="drawer-contact-name" style="font-size:1.3rem;">${esc(p.name || 'Unnamed')} ${dossierReady ? '<i class="bi bi-stars" title="AI call-prep dossier available"></i>' : ''}</div>
          <div class="drawer-contact-title">${esc(p.title || 'Title unknown')}</div>
          ${tag ? `<div class="contact-tags" style="margin-top:6px;"><span class="tag">${esc(tag)}</span></div>` : ''}
        </div>
      </div>
      <div class="drawer-actions">
        <a class="drawer-action ${p.email ? '' : 'disabled'}" ${p.email ? `href="mailto:${esc(p.email)}"` : ''}><i class="bi bi-envelope"></i> Email</a>
        <a class="drawer-action ${p.phone ? '' : 'disabled'}" ${p.phone ? `href="tel:${esc(p.phone)}"` : ''}><i class="bi bi-telephone"></i> Call</a>
        <a class="drawer-action ${p.linkedin_url ? '' : 'disabled'}" ${p.linkedin_url ? `href="${esc(p.linkedin_url)}" target="_blank"` : ''}><i class="bi bi-linkedin"></i> LinkedIn</a>
        <button type="button" class="drawer-action" id="drawerDownloadPdfBtn"><i class="bi bi-file-earmark-pdf"></i> Download PDF</button>
      </div>
    </div>
  `;
}

function renderContactInfoWidget(p) {
  const meta = [
    p.decision_authority ? `Decision authority: ${p.decision_authority}` : '',
    p.budget_authority ? `Budget authority: ${p.budget_authority}` : '',
    p.seniority_raw ? `Seniority: ${p.seniority_raw}` : '',
    [p.city, p.state, p.country].filter(Boolean).join(', ')
  ].filter(Boolean);

  return `
    <div class="panel">
      <div class="panel-title"><span><i class="bi bi-person-vcard"></i> Contact Info</span></div>
      ${meta.length ? meta.map(m => `<div class="stat-row"><span class="stat-label">${esc(m)}</span></div>`).join('')
        : `<div class="empty-block" style="padding:6px 0;"><div class="empty-block-text">No additional contact metadata captured yet.</div></div>`}
      ${(p.skills && p.skills.length) ? `
        <div class="panel-title" style="margin-top:14px;"><span><i class="bi bi-lightning-charge"></i> Skills &amp; Focus Areas</span></div>
        <div class="chip-row">${p.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
      ` : ''}
    </div>
  `;
}

function renderDossierWidget(p) {
  return `
    <div class="panel">
      <div class="panel-title"><span><i class="bi bi-stars"></i> AI Call-Prep Dossier</span></div>
      ${renderDossier(p)}
    </div>
  `;
}

function renderPersonalityWidget(digestEntry) {
  return `
    <div class="panel">
      <div class="panel-title"><span><i class="bi bi-person-lines-fill"></i> Personality Profile</span></div>
      ${renderPersonalityProfile(digestEntry)}
    </div>
  `;
}

function renderSocialWidget(digestEntry, posts) {
  const summary = renderPersonaContentSummary(digestEntry, posts);
  const allPosts = renderAllPostsByChannel(posts);
  return `
    <div class="panel">
      <div class="panel-title">
        <span><i class="bi bi-broadcast"></i> Recent Social Media Activity</span>
        <span class="context-badge live">${posts.length} post${posts.length !== 1 ? 's' : ''} captured</span>
      </div>
      ${summary || ''}
      ${posts.length ? `
        <div class="panel-title" style="margin-top:16px;"><span><i class="bi bi-collection"></i> All Captured Posts</span></div>
        ${allPosts}
      ` : `
        <div class="empty-block" style="padding:16px 4px;">
          <div class="empty-block-icon"><i class="bi bi-inbox"></i></div>
          <div class="empty-block-text">No recent posts available. Pulling real post content needs a social-listening integration — nothing here is invented.</div>
        </div>`}
    </div>
  `;
}

export function renderFullProfile(p) {
  const targetKey = resolvePersonaTargetKey(p);
  const posts = targetKey ? (state.contentStore.posts[targetKey] || []) : [];
  const digestEntry = targetKey ? state.contentStore.digests[targetKey] : null;

  return `
    ${renderHero(p)}
    <div class="profile-widget-grid">
      ${renderContactInfoWidget(p)}
      ${renderDossierWidget(p)}
    </div>
    ${renderPersonalityWidget(digestEntry)}
    ${renderSocialWidget(digestEntry, posts)}
  `;
}
