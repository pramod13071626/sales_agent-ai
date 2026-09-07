// Pure, DOM-side-effect-free rendering helpers shared between the sliding
// contact drawer (contact-drawer.js) and the standalone full-page profile
// (full-profile.js). Kept side-effect-free (no top-level addEventListener,
// no reliance on drawer-only DOM ids) so either page can import from here
// without pulling in the other's markup requirements.
import { CHANNEL_ICON, CHANNEL_LABEL, STRENGTH_PILL } from './constants.js';
import { esc, isDryRunDigest } from './utils.js';
import { renderChannelCard } from './content-panel.js';

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

// Every captured post, grouped by channel with a header per group — unlike
// renderSocialActivity's drawer view (capped at 6 posts total to fit a
// narrow sidebar), the full-page profile has room to show everything.
export function renderAllPostsByChannel(posts) {
  if (!posts.length) return '';
  const byChannel = {};
  posts.forEach(post => { (byChannel[post.channel] = byChannel[post.channel] || []).push(post); });

  return Object.entries(byChannel).map(([ch, arr]) => `
    <div class="profile-post-group">
      <div class="dossier-label"><i class="bi ${CHANNEL_ICON[ch] || 'bi-globe2'}"></i> ${esc(CHANNEL_LABEL[ch] || ch)} <span class="pill pill-muted" style="margin-left:6px;">${arr.length}</span></div>
      <div class="post-card-list">${arr.map(renderPostCard).join('')}</div>
    </div>
  `).join('');
}

export function renderPlaceholderProfile(reason) {
  return `<div class="empty-block" style="padding:16px 4px;">
    <div class="empty-block-icon"><i class="bi bi-slash-circle"></i></div>
    <div class="empty-block-text">${esc(reason)}</div>
  </div>`;
}

// The Personality Profile is a deliberately scoped, hedged synthesis (see
// PERSONALITY_PROFILE_SYSTEM in apps/content_pipeline/digest/prompts.py) —
// professional leadership/decision/values/reputation traits only, always
// cited back to a source_url, never a verified psychological assessment.
export const PERSONALITY_SECTIONS = [
  { key: 'leadership_character', title: 'Leadership Character', icon: 'bi-flag' },
  { key: 'decision_making_style', title: 'Decision-Making Style', icon: 'bi-signpost-split' },
  { key: 'values_and_motivation', title: 'Values and Motivation', icon: 'bi-compass' },
  { key: 'public_reputation', title: 'Public Reputation', icon: 'bi-megaphone' }
];

export function renderProfileSubsection(title, icon, section) {
  if (!section || (!section.summary && !(section.basis || []).length)) return '';
  const pill = STRENGTH_PILL[section.evidence_strength] || '';
  const basis = section.basis || [];
  return `
    <div class="dossier-block">
      <div class="dossier-label">
        <i class="bi ${icon}"></i> ${esc(title)}
        ${section.evidence_strength ? `<span class="pill ${pill}" style="margin-left:8px;">${esc(section.evidence_strength)} evidence</span>` : ''}
      </div>
      ${section.summary ? `<div class="dossier-text">${esc(section.summary)}</div>` : ''}
      ${basis.length ? `<ul class="profile-basis-list">${basis.map(b => `<li>${esc(b.point || '')}${(b.source_url && b.source_url !== 'bio') ? ` — <a href="${esc(b.source_url)}" target="_blank" rel="noopener">source</a>` : ''}</li>`).join('')}</ul>` : ''}
    </div>
  `;
}

export function renderPersonalityProfile(digestEntry) {
  if (!digestEntry || isDryRunDigest(digestEntry)) {
    return renderPlaceholderProfile('Not available yet — this contact\'s AI digest hasn\'t run with a real model. Regenerate the digest to build a Personality Profile.');
  }
  const profile = (digestEntry.digest || {}).personality_profile;
  if (!profile) {
    return renderPlaceholderProfile('Not available — this digest predates the Personality Profile feature. Re-run the digest to generate one.');
  }

  const sub = PERSONALITY_SECTIONS
    .map(s => renderProfileSubsection(s.title, s.icon, (profile.executive_profile || {})[s.key]))
    .filter(Boolean)
    .join('');

  return `
    <div class="content-provenance" style="margin-bottom:12px;">
      <i class="bi bi-info-circle"></i> AI-synthesized from public posts, filings, and career history — hedged and cited, not a verified psychological assessment.
    </div>
    ${profile.executive_summary ? `
      <div class="dossier-block">
        <div class="dossier-label"><i class="bi bi-person-badge"></i> Executive Summary</div>
        <div class="dossier-text">${esc(profile.executive_summary)}</div>
      </div>` : ''}
    ${sub ? `<div class="dossier-label" style="margin-top:6px;"><i class="bi bi-diagram-3"></i> Executive Profile</div>${sub}` : ''}
    ${(profile.caveats && profile.caveats.length) ? `
      <div class="dossier-block">
        <div class="dossier-label"><i class="bi bi-exclamation-triangle"></i> Caveats</div>
        <ul class="profile-basis-list">${profile.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>` : ''}
  `;
}
