// Pure, DOM-side-effect-free rendering helpers shared between the sliding
// contact drawer (contact-drawer.js) and the standalone full-page profile
// (full-profile.js).
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
    return `<div class="dossier-empty">No AI call-prep dossier generated yet for ${esc(p.name || 'this contact')}.</div>`;
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

// Interactive tabbed version of the call-prep dossier for the full profile page
export function renderDossierTabs(p) {
  if (!hasDossier(p)) {
    return `<div class="dossier-empty">No AI call-prep dossier generated yet for ${esc(p.name || 'this contact')}.</div>`;
  }

  const kpis = p.target_kpis || [];
  const pains = p.operational_pain_points || [];
  const objections = p.key_objections || [];

  return `
    <div class="profile-tabs-header">
      <button type="button" class="profile-tab-btn active" data-tab-target="tab-pitch"><i class="bi bi-lightning-charge"></i> Pitch &amp; Icebreaker</button>
      <button type="button" class="profile-tab-btn" data-tab-target="tab-pains"><i class="bi bi-crosshair"></i> Pain Points &amp; KPIs</button>
      <button type="button" class="profile-tab-btn" data-tab-target="tab-objections"><i class="bi bi-shield-x"></i> Objections (${objections.length})</button>
    </div>

    <div class="profile-tab-pane active" id="tab-pitch">
      ${p.personalized_icebreaker ? `
        <div class="icebreaker-card">
          <div class="icebreaker-label"><i class="bi bi-chat-quote-fill"></i> Personalized Icebreaker</div>
          <div class="icebreaker-quote">"${esc(p.personalized_icebreaker)}"</div>
        </div>
      ` : ''}

      ${p.value_proposition ? `
        <div class="dossier-block">
          <div class="dossier-label"><i class="bi bi-bullseye"></i> Targeted Value Proposition</div>
          <div class="dossier-text" style="font-size:.88rem; line-height:1.5;">${esc(p.value_proposition)}</div>
        </div>
      ` : ''}

      ${p.communication_style ? `
        <div class="dossier-block">
          <div class="dossier-label"><i class="bi bi-chat-dots"></i> Recommended Communication Tone</div>
          <div class="dossier-text">${esc(p.communication_style)}</div>
        </div>
      ` : ''}
    </div>

    <div class="profile-tab-pane" id="tab-pains">
      ${pains.length ? `
        <div class="dossier-block">
          <div class="dossier-label"><i class="bi bi-exclamation-triangle"></i> Operational Pain Points</div>
          <div class="chip-row">${pains.map(pain => `<span class="chip" style="background:rgba(255,77,79,0.08); color:var(--danger); border-color:rgba(255,77,79,0.2);">${esc(pain)}</span>`).join('')}</div>
        </div>
      ` : '<div class="empty-block-text">No operational pain points recorded.</div>'}

      ${kpis.length ? `
        <div class="dossier-block" style="margin-top:10px;">
          <div class="dossier-label"><i class="bi bi-flag"></i> Target KPIs &amp; Mandates</div>
          <div class="chip-row">${kpis.map(k => `<span class="chip" style="background:rgba(0,186,136,0.08); color:var(--success); border-color:rgba(0,186,136,0.2);">${esc(k)}</span>`).join('')}</div>
        </div>
      ` : ''}
    </div>

    <div class="profile-tab-pane" id="tab-objections">
      ${objections.length ? `
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${objections.map(obj => `
            <div class="battlecard-item">
              <div class="battlecard-header"><i class="bi bi-shield-exclamation"></i> Potential Objection</div>
              <div class="battlecard-body">${esc(obj)}</div>
            </div>
          `).join('')}
        </div>
      ` : '<div class="empty-block-text">No recorded objections for this contact.</div>'}
    </div>
  `;
}

// Actionable Sales Engagement Playbook
export function renderApproachPlaybook(persona) {
  const commStyle = persona.communication_style || 'Strategic, executive-level, ROI & shareholder-value oriented';
  return `
    <div class="playbook-box">
      <div class="playbook-title"><i class="bi bi-compass"></i> Executive Engagement Strategy</div>
      <ul class="playbook-list">
        <li><strong>Structural Clarity:</strong> Lead with concrete ROI, scalable architecture, and measurable business outcomes.</li>
        <li><strong>Executive Tone:</strong> ${esc(commStyle)}. Focus on enterprise impact rather than raw technical jargon.</li>
        <li><strong>Team &amp; Client Alignment:</strong> Highlight how the solution enhances operational efficiency and empowers key stakeholders.</li>
      </ul>
    </div>
  `;
}

export const PERSONALITY_SECTIONS = [
  { key: 'leadership_character', title: 'Leadership Character', icon: 'bi-flag' },
  { key: 'decision_making_style', title: 'Decision-Making Style', icon: 'bi-signpost-split' },
  { key: 'values_and_motivation', title: 'Values and Motivation', icon: 'bi-compass' },
  { key: 'public_reputation', title: 'Public Reputation', icon: 'bi-megaphone' }
];

export function renderProfileSubsection(title, icon, section) {
  if (!section || (!section.summary && !(section.basis || []).length)) return '';
  const pill = STRENGTH_PILL[section.evidence_strength] || 'pill-muted';
  const basis = section.basis || [];
  return `
    <div class="personality-section-card">
      <div class="personality-sec-header">
        <div class="personality-sec-title"><i class="bi ${icon}"></i> ${esc(title)}</div>
        ${section.evidence_strength ? `<span class="pill ${pill}">${esc(section.evidence_strength)} evidence</span>` : ''}
      </div>
      ${section.summary ? `<p class="personality-sec-body">${esc(section.summary)}</p>` : ''}
      ${basis.length ? `
        <ul class="personality-basis-list">
          ${basis.map(b => `<li><span>${esc(b.point || '')}${(b.source_url && b.source_url !== 'bio') ? ` — <a href="${esc(b.source_url)}" target="_blank" rel="noopener">Source <i class="bi bi-box-arrow-up-right" style="font-size:.7rem;"></i></a>` : ''}</span></li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

// ── Dedicated Executive Personality Profile Renderer ──
// No fabricated fallback content: if this contact's digest hasn't produced
// a real personality_profile yet, say so plainly (renderPlaceholderProfile)
// instead of showing plausible-looking canned text as if it were synthesized.
export function renderFullPersonalityProfile(digestEntry, persona) {
  const profile = (digestEntry && digestEntry.digest) ? digestEntry.digest.personality_profile : null;
  if (!profile) {
    return renderPlaceholderProfile(
      `Not generated yet for ${esc(persona.name || 'this contact')} — run the person digest ` +
      `(python main.py digest <key> --person) to synthesize a real Personality Profile.`
    );
  }

  const execProfile = profile.executive_profile || {};
  const renderedSections = PERSONALITY_SECTIONS
    .map(s => renderProfileSubsection(s.title, s.icon, execProfile[s.key]))
    .filter(Boolean)
    .join('');

  return `
    ${profile.executive_summary ? `
      <div class="personality-summary-card">
        <div class="personality-summary-title"><i class="bi bi-person-badge"></i> Executive Summary</div>
        <p class="personality-summary-text">${esc(profile.executive_summary)}</p>
      </div>` : ''}

    ${renderedSections ? `<div class="personality-sections-list">${renderedSections}</div>` : ''}

    ${renderApproachPlaybook(persona)}

    ${(profile.caveats && profile.caveats.length) ? `
      <div class="personality-section-card" style="border-left: 3px solid var(--warning);">
        <div class="personality-sec-header">
          <div class="personality-sec-title" style="color:#c07a00;"><i class="bi bi-exclamation-triangle"></i> Observation Caveats</div>
        </div>
        <ul class="personality-basis-list">
          ${profile.caveats.map(c => `<li><span>${esc(c)}</span></li>`).join('')}
        </ul>
      </div>` : ''}
  `;
}

export function renderPlaceholderProfile(reason) {
  return `
    <div class="empty-block" style="padding:28px 12px; text-align:center;">
      <div class="empty-block-icon" style="font-size:1.8rem; color:var(--text-muted); margin-bottom:8px;"><i class="bi bi-slash-circle"></i></div>
      <div class="empty-block-text" style="font-size:.84rem; color:var(--text-muted); max-width:400px; margin:0 auto; line-height:1.5;">${esc(reason)}</div>
    </div>
  `;
}

// ── Widget 2: Dedicated Executive Psychological Profile Renderer ──
// Matches PSYCHOLOGICAL_PROFILE_SYSTEM's actual schema exactly (see
// apps/content_pipeline/digest/prompts.py) — every section here really is
// {summary, evidence_strength, basis}, big_five_traits really is just
// {score, summary} per trait, potential_blind_spots really is plain
// strings. No fabricated fallback content: if nothing's been generated
// yet, say so plainly instead of showing a fake report.
export function renderFullPsychologicalProfile(digestEntry, persona, psychData) {
  const profile = psychData || ((digestEntry && digestEntry.digest) ? digestEntry.digest.psychological_profile : null);
  if (!profile) {
    return renderPlaceholderProfile(
      `Not generated yet for ${esc(persona.name || 'this contact')} — run the person digest ` +
      `(python main.py digest <key> --person) to synthesize a real Psychological Profile.`
    );
  }

  const synthesis = profile.psychological_synthesis || {};
  const bigFive = profile.big_five_traits || {};
  const blindSpots = profile.potential_blind_spots || [];
  const playbook = profile.engagement_playbook || {};

  const renderBigFiveMeter = (label, traitObj) => {
    if (!traitObj || traitObj.score == null) return '';
    const score = traitObj.score;
    const pct = Math.min(Math.max((score / 10) * 100, 10), 100);
    return `
      <div class="b5-trait-row">
        <div class="b5-trait-header">
          <span class="b5-trait-name">${esc(label)}</span>
          <span class="b5-trait-score">${score.toFixed(1)} <span style="font-size:.7rem; color:var(--text-muted); font-weight:500;">/ 10</span></span>
        </div>
        <div class="b5-meter-track">
          <div class="b5-meter-fill" style="width:${pct}%;"></div>
        </div>
        ${traitObj.summary ? `<div class="b5-trait-desc">${esc(traitObj.summary)}</div>` : ''}
      </div>
    `;
  };
  const bigFiveMeters = [
    renderBigFiveMeter('Openness to Experience', bigFive.openness),
    renderBigFiveMeter('Conscientiousness', bigFive.conscientiousness),
    renderBigFiveMeter('Extraversion', bigFive.extraversion),
    renderBigFiveMeter('Agreeableness', bigFive.agreeableness),
    renderBigFiveMeter('Emotional Stability', bigFive.emotional_stability),
  ].filter(Boolean).join('');

  return `
    ${(synthesis.archetype || synthesis.summary) ? `
      <div class="psych-archetype-hero">
        <div class="psych-hero-kicker"><i class="bi bi-person-bounding-box"></i> Executive Psychological Archetype</div>
        ${synthesis.archetype ? `<div class="psych-hero-title">${esc(synthesis.archetype)}</div>` : ''}
        ${synthesis.summary ? `<p class="psych-hero-summary">${esc(synthesis.summary)}</p>` : ''}
      </div>` : ''}

    ${profile.executive_summary ? `
      <div class="personality-summary-card" style="margin-top:16px;">
        <div class="personality-summary-title"><i class="bi bi-journal-text"></i> Executive Summary &amp; Career Trajectory</div>
        <p class="personality-summary-text">${esc(profile.executive_summary)}</p>
      </div>` : ''}

    ${bigFiveMeters ? `
      <div class="psych-card" style="margin-top:16px;">
        <div class="psych-card-header">
          <div class="psych-card-title"><i class="bi bi-bar-chart-steps"></i> Big Five Personality Modeling (1.0 — 10.0 Scale)</div>
          <span class="pill pill-muted">Estimated from Public Record</span>
        </div>
        <div class="b5-grid">${bigFiveMeters}</div>
      </div>` : ''}

    <div class="psych-dual-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
      ${renderProfileSubsection('Cognitive Style', 'bi-cpu', profile.cognitive_style)}
      ${renderProfileSubsection('Leadership & Scale Management', 'bi-people-fill', profile.leadership_patterns)}
    </div>

    ${renderProfileSubsection('Core Values & Motivations', 'bi-compass', profile.core_values_and_motivations)}
    ${renderProfileSubsection('Interpersonal Traits', 'bi-person-heart', profile.interpersonal_traits)}

    ${blindSpots.length ? `
      <div class="psych-card" style="margin-top:16px; border-left:3px solid #F5A623;">
        <div class="psych-card-header">
          <div class="psych-card-title" style="color:#d97706;"><i class="bi bi-shield-exclamation"></i> Inferred Operational &amp; Cognitive Blind Spots</div>
          <span class="pill pill-warning">Risk Mitigation</span>
        </div>
        <ul class="personality-basis-list" style="margin-top:8px;">
          ${blindSpots.map(bs => `<li><span>${esc(bs)}</span></li>`).join('')}
        </ul>
      </div>` : ''}

    ${(playbook.dos || playbook.donts || playbook.opening_hook) ? `
      <div class="psych-card" style="margin-top:16px;">
        <div class="psych-card-header">
          <div class="psych-card-title"><i class="bi bi-briefcase"></i> Actionable Executive Engagement Playbook</div>
          <span class="pill pill-success">Sales Strategy</span>
        </div>

        ${playbook.opening_hook ? `
          <div class="icebreaker-card" style="margin:10px 0 14px;">
            <div class="icebreaker-label"><i class="bi bi-chat-quote-fill"></i> Recommended Opening Hook</div>
            <div class="icebreaker-quote">"${esc(playbook.opening_hook)}"</div>
          </div>` : ''}
        ${playbook.recommended_tone ? `<div class="psych-sub-block" style="margin-bottom:10px;"><strong>Recommended tone:</strong> ${esc(playbook.recommended_tone)}</div>` : ''}

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
          ${(playbook.dos || []).length ? `
            <div style="background:rgba(0,186,136,0.05); border:1px solid rgba(0,186,136,0.2); border-radius:var(--radius-sm); padding:12px 14px;">
              <div style="font-weight:700; font-size:.82rem; color:var(--success); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.04em;"><i class="bi bi-check-circle-fill"></i> Recommended (Do This)</div>
              <ul style="padding-left:18px; margin:0; font-size:.82rem; color:var(--text-primary); line-height:1.55;">
                ${playbook.dos.map(d => `<li>${esc(d)}</li>`).join('')}
              </ul>
            </div>` : ''}
          ${(playbook.donts || []).length ? `
            <div style="background:rgba(255,77,79,0.05); border:1px solid rgba(255,77,79,0.2); border-radius:var(--radius-sm); padding:12px 14px;">
              <div style="font-weight:700; font-size:.82rem; color:var(--danger); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.04em;"><i class="bi bi-x-circle-fill"></i> Avoid (Don't Do This)</div>
              <ul style="padding-left:18px; margin:0; font-size:.82rem; color:var(--text-primary); line-height:1.55;">
                ${playbook.donts.map(d => `<li>${esc(d)}</li>`).join('')}
              </ul>
            </div>` : ''}
        </div>
      </div>` : ''}

    ${(profile.caveats && profile.caveats.length) ? `
      <div class="personality-section-card" style="border-left: 3px solid var(--warning); margin-top:16px;">
        <div class="personality-sec-header">
          <div class="personality-sec-title" style="color:#c07a00;"><i class="bi bi-exclamation-triangle"></i> Observation Caveats</div>
        </div>
        <ul class="personality-basis-list">
          ${profile.caveats.map(c => `<li><span>${esc(c)}</span></li>`).join('')}
        </ul>
      </div>` : ''}
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
    <div class="post-card" data-post-channel="${esc(post.channel || 'all')}">
      <div class="post-card-header">
        <span class="post-card-channel"><i class="bi ${icon}"></i> ${esc(label)}</span>
        ${post.published_at ? `<span class="post-card-date">${esc(post.published_at)}</span>` : ''}
      </div>
      ${post.author ? `<div class="post-card-author">${esc(post.author)}</div>` : ''}
      ${body ? `<p class="post-card-body">${esc(body)}</p>` : ''}
      <div class="post-card-footer">
        ${engBits ? `<span class="post-card-engagement">${engBits}</span>` : '<span></span>'}
        ${post.post_url ? `<a href="${esc(post.post_url)}" target="_blank" rel="noopener">Source <i class="bi bi-box-arrow-up-right"></i></a>` : ''}
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

  const byChannel = {};
  posts.forEach(post => { (byChannel[post.channel] = byChannel[post.channel] || []).push(post); });
  const dates = posts.map(post => post.published_at).filter(Boolean);

  return `
    <div class="chip-row" style="margin-bottom:12px;">
      ${Object.entries(byChannel).map(([ch, arr]) => `<span class="chip"><i class="bi ${CHANNEL_ICON[ch] || 'bi-globe2'}"></i> ${esc(CHANNEL_LABEL[ch] || ch)}: ${arr.length}</span>`).join('')}
      ${dates.length ? `<span class="chip"><i class="bi bi-calendar3"></i> Latest: ${esc(dates[0])}</span>` : ''}
    </div>
  `;
}

// Filterable Multi-Channel Post Feed
export function renderTabbedSignalsWidget(digestEntry, posts) {
  if (!posts.length) {
    return `
      <div class="empty-block" style="padding:24px 8px;">
        <div class="empty-block-icon"><i class="bi bi-inbox"></i></div>
        <div class="empty-block-text">No captured public signals or posts available for this contact.</div>
      </div>
    `;
  }

  const byChannel = {};
  posts.forEach(post => {
    const ch = post.channel || 'other';
    (byChannel[ch] = byChannel[ch] || []).push(post);
  });

  return `
    <div class="channel-filters-bar">
      <button type="button" class="channel-filter-pill active" data-filter="all">
        <i class="bi bi-collection"></i> All Signals <span class="pill-count">${posts.length}</span>
      </button>
      ${Object.entries(byChannel).map(([ch, arr]) => `
        <button type="button" class="channel-filter-pill" data-filter="${esc(ch)}">
          <i class="bi ${CHANNEL_ICON[ch] || 'bi-globe2'}"></i> ${esc(CHANNEL_LABEL[ch] || ch)} <span class="pill-count">${arr.length}</span>
        </button>
      `).join('')}
    </div>

    <div class="profile-feed-grid" id="profilePostFeed">
      ${posts.slice(0, 12).map(renderPostCard).join('')}
    </div>

    <div class="profile-pagination-bar" id="profileFeedPagination"></div>
  `;
}

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
      <i class="bi bi-info-circle"></i> AI-synthesized from public posts, filings, and career history — hedged and cited.
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
