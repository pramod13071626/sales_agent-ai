import { state } from './state.js';
import { el, drawerTitle, drawerPinned, drawerBody, contactDrawer, drawerBackdrop } from './dom.js';
import { CHANNEL_ICON, CHANNEL_LABEL } from './constants.js';
import { esc, initials, resolvePersonaTargetKey, isDryRunDigest } from './utils.js';
import { renderChannelCard } from './content-panel.js';
import { closeSignalModal } from './signal-modal.js';

export function hasDossier(p) {
  return !!(p.personalized_icebreaker || p.value_proposition || p.communication_style ||
    (p.target_kpis && p.target_kpis.length) || (p.operational_pain_points && p.operational_pain_points.length) ||
    (p.key_objections && p.key_objections.length) || p.prior_company || p.degree || p.institution);
}

export function renderDossier(p) {
  if (!hasDossier(p)) {
    return `<div class="dossier-empty">No AI call-prep dossier generated yet for ${esc(p.name || 'this contact')}. Use "Fetch" on their card in the Account Explorer to generate one.</div>`;
  }
  const chipGroup = (title, icon, items) => (items && items.length)
    ? `<div class="dossier-block"><div class="dossier-label"><i class="bi ${icon}"></i> ${esc(title)}</div><div class="chip-row">${items.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div></div>`
    : '';
  const background = [p.prior_company ? `Previously at ${p.prior_company}` : '', (p.degree || p.institution) ? `${p.degree || 'Degree'}${p.institution ? ', ' + p.institution : ''}` : '']
    .filter(Boolean).join(' • ');

  return `
    ${p.personalized_icebreaker ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-chat-quote"></i> Icebreaker</div><div class="dossier-quote">"${esc(p.personalized_icebreaker)}"</div></div>` : ''}
    ${p.value_proposition ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-bullseye"></i> Value Proposition</div><div class="dossier-text">${esc(p.value_proposition)}</div></div>` : ''}
    ${p.communication_style ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-chat-dots"></i> Communication Style</div><div class="dossier-text">${esc(p.communication_style)}</div></div>` : ''}
    ${chipGroup('Target KPIs', 'bi-flag', p.target_kpis)}
    ${chipGroup('Operational Pain Points', 'bi-exclamation-triangle', p.operational_pain_points)}
    ${chipGroup('Likely Objections', 'bi-shield-x', p.key_objections)}
    ${background ? `<div class="dossier-block"><div class="dossier-label"><i class="bi bi-mortarboard"></i> Background</div><div class="dossier-text">${esc(background)}</div></div>` : ''}
  `;
}

export function renderPostCard(post) {
  const icon = CHANNEL_ICON[post.channel] || 'bi-globe2';
  const label = CHANNEL_LABEL[post.channel] || post.channel;
  const eng = post.engagement || {};
  const engBits = [
    eng.likes != null ? `<span><i class="bi bi-hand-thumbs-up"></i> ${eng.likes}</span>` : '',
    eng.comments != null ? `<span><i class="bi bi-chat"></i> ${eng.comments}</span>` : '',
    eng.shares != null ? `<span><i class="bi bi-share"></i> ${eng.shares}</span>` : ''
  ].filter(Boolean).join('');
  const body = (post.body || '').length > 260 ? post.body.slice(0, 260) + '…' : (post.body || '');

  return `
    <div class="post-card">
      <div class="post-card-header">
        <span class="post-card-channel"><i class="bi ${icon}"></i> ${esc(label)}</span>
        ${post.published_at ? `<span class="post-card-date">${esc(post.published_at)}</span>` : ''}
      </div>
      ${post.author ? `<div class="post-card-author">${esc(post.author)}</div>` : ''}
      ${body ? `<p class="post-card-body">${esc(body)}</p>` : ''}
      <div class="post-card-footer">
        ${engBits ? `<span class="post-card-engagement">${engBits}</span>` : '<span></span>'}
        ${post.post_url ? `<a href="${esc(post.post_url)}" target="_blank">Open <i class="bi bi-box-arrow-up-right"></i></a>` : ''}
      </div>
    </div>
  `;
}

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

export function renderPersonaContentSummary(digestEntry, posts) {
  if (!posts.length && !digestEntry) return '';

  if (digestEntry && !isDryRunDigest(digestEntry)) {
    const channels = (digestEntry.digest && digestEntry.digest.channels) || [];
    if (channels.length) {
      return `<div class="content-channel-grid" style="margin-bottom:12px;">${channels.map(renderChannelCard).join('')}</div>`;
    }
  }

  if (!posts.length) return '';

  // No usable AI digest — summarize what was actually captured, no invented text.
  const byChannel = {};
  posts.forEach(post => { (byChannel[post.channel] = byChannel[post.channel] || []).push(post); });
  const dates = posts.map(post => post.published_at).filter(Boolean);

  return `
    <div class="content-provenance" style="margin-bottom:8px;">
      <i class="bi bi-info-circle"></i> ${digestEntry ? 'AI digest wasn’t generated for this contact (no LLM configured on the source run)' : 'No AI digest generated yet'} — showing a summary of captured activity instead.
    </div>
    <div class="chip-row" style="margin-bottom:12px;">
      ${Object.entries(byChannel).map(([ch, arr]) => `<span class="chip"><i class="bi ${CHANNEL_ICON[ch] || 'bi-globe2'}"></i> ${esc(CHANNEL_LABEL[ch] || ch)}: ${arr.length}</span>`).join('')}
      ${dates.length ? `<span class="chip"><i class="bi bi-calendar3"></i> Most recent: ${esc(dates[0])}</span>` : ''}
    </div>
  `;
}

export function renderPlaceholderProfile(reason) {
  return `<div class="empty-block" style="padding:16px 4px;">
    <div class="empty-block-icon"><i class="bi bi-slash-circle"></i></div>
    <div class="empty-block-text">${esc(reason)}</div>
  </div>`;
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
        <div class="drawer-section-title"><i class="bi bi-activity"></i> Psychological Profile</div>
        ${renderPlaceholderProfile('Not available — no data source for psychological profiling is connected.')}
      </div>

      <div class="drawer-section drawer-section-muted">
        <div class="drawer-section-title"><i class="bi bi-person-lines-fill"></i> Personality Profile</div>
        ${renderPlaceholderProfile('Not available — no personality-assessment source (e.g. DISC/Big Five) is connected.')}
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
}

export function closeContactDrawer() {
  contactDrawer.classList.remove('open');
  drawerBackdrop.classList.remove('open');
}

el('drawerClose').addEventListener('click', closeContactDrawer);
drawerBackdrop.addEventListener('click', closeContactDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeContactDrawer();
  closeSignalModal();
});

contactDrawer.addEventListener('click', function (e) {
  const jumpBtn = e.target.closest('[data-jump]');
  if (!jumpBtn) return;
  const target = drawerBody.querySelector(`#${jumpBtn.dataset.jump}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  drawerPinned.querySelectorAll('.drawer-jump-btn').forEach(b => b.classList.remove('active'));
  jumpBtn.classList.add('active');
});
