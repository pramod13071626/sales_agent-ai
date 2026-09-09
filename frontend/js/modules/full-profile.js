// Full-page executive contact profile — modern modular Bento-Grid dashboard
import { state } from './state.js';
import { esc, initials, resolvePersonaTargetKey } from './utils.js';
import {
  hasDossier,
  renderDossierTabs,
  renderFullPersonalityProfile,
  renderFullPsychologicalProfile,
  renderTabbedSignalsWidget
} from './profile-render.js';

function renderHeroCard(p) {
  const isCSuite = (p.tier === 'c_suite') || (p.hierarchy_level === 1);
  const dossierReady = hasDossier(p);
  const location = [p.city, p.state, p.country].filter(Boolean).join(', ');

  return `
    <div class="profile-hero-card">
      <div class="profile-hero-identity">
        <div class="profile-avatar-xl">${esc(initials(p.name))}</div>
        <div class="profile-hero-info">
          <div class="profile-hero-name">
            ${esc(p.name || 'Executive Contact')}
            ${dossierReady ? '<i class="bi bi-stars" title="AI call-prep dossier available"></i>' : ''}
          </div>
          <div class="profile-hero-title">${esc(p.title || 'Executive Title')}</div>
          ${p.company_name ? `<div class="profile-hero-company"><i class="bi bi-building"></i> ${esc(p.company_name)}</div>` : ''}
          <div class="profile-hero-meta-chips">
            ${isCSuite ? '<span class="meta-badge badge-csuite"><i class="bi bi-award"></i> C-Suite</span>' : ''}
            ${p.decision_authority ? `<span class="meta-badge badge-authority"><i class="bi bi-check2-circle"></i> ${esc(p.decision_authority)} Authority</span>` : ''}
            ${p.budget_authority ? `<span class="meta-badge"><i class="bi bi-wallet2"></i> ${esc(p.budget_authority)} Budget</span>` : ''}
            ${location ? `<span class="meta-badge"><i class="bi bi-geo-alt"></i> ${esc(location)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="profile-hero-actions">
        <a class="profile-action-btn ${p.email ? '' : 'disabled'}" ${p.email ? `href="mailto:${esc(p.email)}"` : ''}><i class="bi bi-envelope"></i> Email</a>
        <a class="profile-action-btn ${p.phone ? '' : 'disabled'}" ${p.phone ? `href="tel:${esc(p.phone)}"` : ''}><i class="bi bi-telephone"></i> Call</a>
        <a class="profile-action-btn ${p.linkedin_url ? '' : 'disabled'}" ${p.linkedin_url ? `href="${esc(p.linkedin_url)}" target="_blank" rel="noopener"` : ''}><i class="bi bi-linkedin"></i> LinkedIn</a>
      </div>
    </div>
  `;
}

// Widget: Sales Call-Prep & Battlecards
function renderCallPrepWidget(persona) {
  return `
    <div class="profile-widget">
      <div class="profile-widget-header">
        <div class="profile-widget-title"><i class="bi bi-chat-left-text"></i> Sales Call-Prep &amp; Battlecards</div>
        <span class="profile-widget-tag">Active Mandates</span>
      </div>
      ${renderDossierTabs(persona)}
    </div>
  `;
}

// Widget: Professional Background & Competencies
function renderBackgroundWidget(persona) {
  const background = [
    persona.prior_company ? `Previously at ${persona.prior_company}` : '',
    (persona.degree || persona.institution) ? `${persona.degree || 'Degree'}${persona.institution ? ', ' + persona.institution : ''}` : ''
  ].filter(Boolean).join(' • ');

  return `
    <div class="profile-widget">
      <div class="profile-widget-header">
        <div class="profile-widget-title"><i class="bi bi-briefcase"></i> Professional Background &amp; Competencies</div>
        <span class="profile-widget-tag">Profile Data</span>
      </div>

      ${background ? `
        <div class="dossier-block">
          <div class="dossier-label"><i class="bi bi-mortarboard"></i> Academic &amp; Prior Corporate Career</div>
          <div class="dossier-text">${esc(background)}</div>
        </div>
      ` : ''}

      ${(persona.skills && persona.skills.length) ? `
        <div class="dossier-block">
          <div class="dossier-label"><i class="bi bi-lightning-charge"></i> Core Competencies &amp; Focus Areas</div>
          <div class="chip-row">${persona.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
        </div>
      ` : ''}

      ${(!background && !(persona.skills && persona.skills.length)) ? `
        <div class="empty-block" style="padding:20px 4px; text-align:center;">
          <div class="empty-block-text">No additional academic background or skills tags recorded yet.</div>
        </div>
      ` : ''}
    </div>
  `;
}

// Widget: Executive Personality Profile
function renderPersonalityProfileWidget(digestEntry, persona) {
  return `
    <div class="profile-widget">
      <div class="profile-widget-header">
        <div class="profile-widget-title"><i class="bi bi-person-lines-fill"></i> Executive Personality Profile</div>
        <button type="button" class="profile-action-btn btn-primary" id="drawerDownloadPdfBtn" style="padding: 5px 12px; font-size: .8rem; font-weight: 600;"><i class="bi bi-file-earmark-pdf"></i> Download Personality Report</button>
      </div>
      ${renderFullPersonalityProfile(digestEntry, persona)}
    </div>
  `;
}

// Widget: Executive Psychological Profile (Placeholder / Not Connected)
function renderPsychologicalProfileWidget() {
  return `
    <div class="profile-widget">
      <div class="profile-widget-header">
        <div class="profile-widget-title"><i class="bi bi-activity"></i> Executive Psychological Profile</div>
        <button type="button" class="profile-action-btn btn-primary disabled" style="padding: 5px 12px; font-size: .8rem; font-weight: 600;" title="Psychological profile is not currently connected"><i class="bi bi-file-earmark-pdf"></i> Download Psychological Report</button>
      </div>
      ${renderFullPsychologicalProfile()}
    </div>
  `;
}

// Widget: Multi-Channel Signals & Public Activity
function renderSignalsWidget(digestEntry, posts) {
  return `
    <div class="profile-widget">
      <div class="profile-widget-header">
        <div class="profile-widget-title"><i class="bi bi-broadcast-pin"></i> Captured Public Signals &amp; Activity</div>
        <span class="profile-widget-tag">${posts.length} Captured Signal${posts.length !== 1 ? 's' : ''}</span>
      </div>
      ${renderTabbedSignalsWidget(digestEntry, posts)}
    </div>
  `;
}

export function renderFullProfile(p) {
  const targetKey = resolvePersonaTargetKey(p);
  const posts = targetKey ? (state.contentStore.posts[targetKey] || []) : [];
  const digestEntry = targetKey ? state.contentStore.digests[targetKey] : null;

  return `
    ${renderHeroCard(p)}

    <!-- Parallel Pair 1: Call-Prep & Battlecards || Background & Competencies -->
    <div class="profile-bento-grid">
      ${renderCallPrepWidget(p)}
      ${renderBackgroundWidget(p)}
    </div>

    <!-- Parallel Pair 2: Executive Personality Profile || Psychological Profile -->
    <div class="profile-bento-grid">
      ${renderPersonalityProfileWidget(digestEntry, p)}
      ${renderPsychologicalProfileWidget()}
    </div>

    <!-- Multi-Channel Signals & Public Activity Feed -->
    ${renderSignalsWidget(digestEntry, posts)}
  `;
}
