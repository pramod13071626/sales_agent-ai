import { state } from './state.js';
import { el, drawerTitle, drawerPinned, drawerBody, contactDrawer, drawerBackdrop } from './dom.js';
import { esc, initials, resolvePersonaTargetKey } from './utils.js';
import { closeSignalModal } from './signal-modal.js';
import { triggerPersonaPdfDownload } from './contact-pdf.js';
import {
  hasDossier,
  renderDossier,
  renderPostCard,
  renderPersonaContentSummary,
  renderPlaceholderProfile,
  renderPersonalityProfile
} from './profile-render.js';

export { hasDossier, renderDossier, renderPostCard, renderPersonalityProfile, renderPlaceholderProfile };

export function renderSocialActivity(p) {
  const handles = [];
  if (p.linkedin_url) handles.push({ platform: 'LinkedIn', icon: 'bi-linkedin', url: p.linkedin_url });
  if (p.social_platform && p.social_profile_url && p.social_platform.toLowerCase() !== 'linkedin') {
    handles.push({ platform: p.social_platform, icon: 'bi-link-45deg', url: p.social_profile_url });
  }
  if (p.twitter_handle) handles.push({ platform: 'X / Twitter', icon: 'bi-twitter-x', url: `https://twitter.com/${p.twitter_handle}` });

  const targetKey = resolvePersonaTargetKey(p);
  const posts = targetKey ? (state.contentStore.posts[targetKey] || []) : [];
  const digestEntry = targetKey ? state.contentStore.digests[targetKey] : null;

  return `
    ${handles.length ? `<div class="chip-row" style="margin-bottom:10px;">${handles.map(h => `<a class="social-link" href="${esc(h.url)}" target="_blank"><i class="bi ${h.icon}"></i> ${esc(h.platform)}</a>`).join('')}</div>` : ''}
    ${p.social_presence_level ? `<div class="stat-row"><span class="stat-label">Presence level</span><span class="stat-value">${esc(p.social_presence_level)}</span></div>` : ''}
    ${renderPersonaContentSummary(digestEntry, posts)}
    ${posts.length ? `
      <div class="post-card-list">${posts.slice(0, 6).map(renderPostCard).join('')}</div>
      ${posts.length > 6 ? `<div class="people-empty">+${posts.length - 6} more captured posts</div>` : ''}
    ` : `
      <div class="empty-block" style="padding:16px 4px;">
        <div class="empty-block-icon"><i class="bi bi-inbox"></i></div>
        <div class="empty-block-text">No recent posts available. Pulling real post content needs a social-listening integration — nothing here is invented.</div>
      </div>`}
  `;
}

export function renderDrawerPinned(p) {
  const tag = p.tier || p.decision_authority || (p.departments && p.departments[0]) || null;
  const dossierReady = hasDossier(p);
  return `
    <div class="drawer-contact-header">
      <div class="drawer-avatar">${esc(initials(p.name))}</div>
      <div>
        <div class="drawer-contact-name">${esc(p.name || 'Unnamed')} ${dossierReady ? '<i class="bi bi-stars" title="AI call-prep dossier available"></i>' : ''}</div>
        <div class="drawer-contact-title">${esc(p.title || 'Title unknown')}</div>
        ${tag ? `<div class="contact-tags" style="margin-top:6px;"><span class="tag">${esc(tag)}</span></div>` : ''}
      </div>
    </div>

    <div class="drawer-actions">
      <a class="drawer-action ${p.email ? '' : 'disabled'}" ${p.email ? `href="mailto:${esc(p.email)}"` : ''}><i class="bi bi-envelope"></i> Email</a>
      <a class="drawer-action ${p.phone ? '' : 'disabled'}" ${p.phone ? `href="tel:${esc(p.phone)}"` : ''}><i class="bi bi-telephone"></i> Call</a>
      <a class="drawer-action ${p.linkedin_url ? '' : 'disabled'}" ${p.linkedin_url ? `href="${esc(p.linkedin_url)}" target="_blank"` : ''}><i class="bi bi-linkedin"></i> LinkedIn</a>
      <button type="button" class="drawer-action ${p.id == null ? 'disabled' : ''}" id="drawerViewProfileBtn"><i class="bi bi-arrow-up-right-square"></i> View Profile</button>
      <button type="button" class="drawer-action" id="drawerDownloadPdfBtn"><i class="bi bi-file-earmark-pdf"></i> Download PDF</button>
    </div>

    <div class="drawer-jumpnav">
      <button type="button" class="drawer-jump-btn active" data-jump="drawer-sec-overview">Overview</button>
      <button type="button" class="drawer-jump-btn" data-jump="drawer-sec-dossier">Call Prep</button>
      <button type="button" class="drawer-jump-btn" data-jump="drawer-sec-social">Social</button>
      <button type="button" class="drawer-jump-btn" data-jump="drawer-sec-profiles">Profiles</button>
    </div>
  `;
}

export function renderContactDrawer(p) {
  const targetKey = resolvePersonaTargetKey(p);
  const meta = [
    p.decision_authority ? `Decision authority: ${p.decision_authority}` : '',
    p.budget_authority ? `Budget authority: ${p.budget_authority}` : '',
    p.seniority_raw ? `Seniority: ${p.seniority_raw}` : '',
    [p.city, p.state, p.country].filter(Boolean).join(', ')
  ].filter(Boolean);

  return `
    <div id="drawer-sec-overview">
      ${meta.length ? `
        <div class="drawer-section">
          <div class="drawer-section-title"><i class="bi bi-person-vcard"></i> Contact Info</div>
          ${meta.map(m => `<div class="stat-row"><span class="stat-label">${esc(m)}</span></div>`).join('')}
        </div>` : ''}

      ${(p.skills && p.skills.length) ? `
        <div class="drawer-section">
          <div class="drawer-section-title"><i class="bi bi-lightning-charge"></i> Skills &amp; Focus Areas</div>
          <div class="chip-row">${p.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
        </div>` : ''}

      ${(!meta.length && !(p.skills && p.skills.length)) ? `
        <div class="drawer-section">
          <div class="drawer-section-title"><i class="bi bi-person-vcard"></i> Contact Info</div>
          <div class="empty-block" style="padding:6px 0;"><div class="empty-block-text">No additional contact metadata captured yet.</div></div>
        </div>` : ''}
    </div>

    <div class="drawer-section" id="drawer-sec-dossier">
      <div class="drawer-section-title"><i class="bi bi-stars"></i> AI Call-Prep Dossier</div>
      ${renderDossier(p)}
    </div>

    <div class="drawer-section" id="drawer-sec-social">
      <div class="drawer-section-title"><i class="bi bi-broadcast"></i> Recent Social Media Activity</div>
      ${renderSocialActivity(p)}
    </div>

    <div id="drawer-sec-profiles">
      <div class="drawer-section drawer-section-muted">
        <div class="drawer-section-title"><i class="bi bi-activity"></i> Executive Psychological Profile</div>
        ${renderPlaceholderProfile('Not available — no data source for psychological profiling is connected.')}
      </div>

      <div class="drawer-section" id="drawer-sec-personality">
        <div class="drawer-section-title"><i class="bi bi-person-lines-fill"></i> Personality Profile</div>
        ${renderPersonalityProfile(targetKey ? state.contentStore.digests[targetKey] : null)}
      </div>
    </div>
  `;
}

export function openContactDrawer(p) {
  drawerTitle.textContent = p.name || 'Contact';
  drawerPinned.innerHTML = renderDrawerPinned(p);
  drawerBody.innerHTML = renderContactDrawer(p);
  drawerBody.scrollTop = 0;
  contactDrawer.classList.add('open');
  drawerBackdrop.classList.add('open');
  state.activeDrawerPersona = p;
}

export function closeContactDrawer() {
  contactDrawer.classList.remove('open');
  drawerBackdrop.classList.remove('open');
  state.activeDrawerPersona = null;
}

el('drawerClose').addEventListener('click', closeContactDrawer);
drawerBackdrop.addEventListener('click', closeContactDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeContactDrawer();
  closeSignalModal();
});

contactDrawer.addEventListener('click', function (e) {
  const downloadBtn = e.target.closest('#drawerDownloadPdfBtn');
  if (downloadBtn) {
    if (state.activeDrawerPersona) triggerPersonaPdfDownload(state.activeDrawerPersona);
    return;
  }

  const viewProfileBtn = e.target.closest('#drawerViewProfileBtn');
  if (viewProfileBtn) {
    const p = state.activeDrawerPersona;
    if (p && p.id != null && state.activeAccountId != null) {
      window.open(`/profile?account=${encodeURIComponent(state.activeAccountId)}&persona_id=${encodeURIComponent(p.id)}`, '_blank', 'noopener');
    }
    return;
  }

  const jumpBtn = e.target.closest('[data-jump]');
  if (!jumpBtn) return;
  const target = drawerBody.querySelector(`#${jumpBtn.dataset.jump}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  drawerPinned.querySelectorAll('.drawer-jump-btn').forEach(b => b.classList.remove('active'));
  jumpBtn.classList.add('active');
});
