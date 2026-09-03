import { state } from './state.js';
import { CONTENT_PIPELINE_URL, CHANNEL_ICON, CHANNEL_LABEL, STRENGTH_PILL } from './constants.js';
import { esc, isDryRunDigest, resolveAccountTargetKey, timeAgo } from './utils.js';

export function renderContentPanel(account) {
  const targetKey = resolveAccountTargetKey(account);
  const posts = targetKey ? (state.contentStore.posts[targetKey] || []) : [];
  const digestEntry = targetKey ? state.contentStore.digests[targetKey] : null;
  const dryRun = isDryRunDigest(digestEntry);

  if (!targetKey || (!posts.length && !digestEntry)) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-inbox"></i></div>
      <div class="empty-block-text">No content intelligence captured yet for this account.</div>
    </div>`;
  }

  if (dryRun) {
    return renderRawPostsFallback(posts, 'This account has captured posts, but the AI digest run had no LLM configured (dry-run) — showing the raw posts instead.');
  }

  const d = digestEntry.digest || {};
  const channels = d.channels || [];
  const metaBits = [
    digestEntry.priority ? `Priority: ${digestEntry.priority}` : '',
    digestEntry.posts_considered != null ? `${digestEntry.posts_considered} posts considered` : '',
    digestEntry.generated_at ? `Generated ${timeAgo(digestEntry.generated_at)}` : ''
  ].filter(Boolean).join(' · ');

  return `
    <div class="content-meta">${esc(metaBits)}</div>
    ${renderContentPipelineLink(targetKey)}
    <div class="content-channel-grid">
      ${channels.map(renderChannelCard).join('')}
    </div>
    <div class="content-provenance"><i class="bi bi-info-circle"></i> Source: ${esc(digestEntry.llm || 'unknown')}</div>
  `;
}

// Opens the live content pipeline app (not just this DB snapshot) so a
// rep can trigger a fresh scrape/digest run, or use its copy-to-clipboard
// sales email + talking points UI, without leaving the sales workflow to
// go find that app.
export function renderContentPipelineLink(targetKey) {
  const url = `${CONTENT_PIPELINE_URL}/frontend/?account=${encodeURIComponent(targetKey)}`;
  return `<a href="${esc(url)}" target="_blank" rel="noopener" class="content-pipeline-link">
    <i class="bi bi-box-arrow-up-right"></i> Open in Content Pipeline
  </a>`;
}

export function renderChannelCard(ch) {
  const icon = CHANNEL_ICON[ch.channel] || 'bi-globe2';
  const label = ch.channel_label || CHANNEL_LABEL[ch.channel] || ch.channel;
  const strengthPill = STRENGTH_PILL[ch.evidence_strength] || '';
  const storyline = ch.storyline || {};
  const doNotSay = ch.do_not_say || [];

  return `
    <div class="content-channel-card">
      <div class="content-channel-header">
        <span class="content-channel-icon"><i class="bi ${icon}"></i></span>
        <span class="content-channel-label">${esc(label)}</span>
        ${ch.evidence_strength ? `<span class="pill ${strengthPill}">${esc(ch.evidence_strength)}</span>` : ''}
        <span class="content-channel-count">${ch.posts_considered != null ? `${ch.posts_considered} posts` : ''}</span>
      </div>

      ${ch.summary ? `<p class="content-summary">${esc(ch.summary)}</p>` : ''}

      ${(ch.observed && ch.observed.length) ? `
        <details class="content-observed">
          <summary>Observed facts (${ch.observed.length})</summary>
          ${(ch.themes && ch.themes.length) ? `<div class="chip-row" style="margin:8px 0;">${ch.themes.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
          <ul class="content-fact-list">
            ${ch.observed.map(o => `<li>${esc(o.fact)}${o.source_url ? ` <a href="${esc(o.source_url)}" target="_blank" title="Source"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}</li>`).join('')}
          </ul>
        </details>` : ''}

      ${ch.interpretation ? `<p class="content-interpretation">${esc(ch.interpretation)}</p>` : ''}

      <div class="content-fields">
        ${ch.sales_angle ? `<div class="content-field"><strong>Sales angle:</strong> ${esc(ch.sales_angle)}</div>` : ''}
        ${storyline.hook ? `<div class="content-field"><strong>Hook:</strong> ${esc(storyline.hook)}</div>` : ''}
        ${storyline.angle ? `<div class="content-field"><strong>Angle:</strong> ${esc(storyline.angle)}${storyline.suggested_tone ? ` <em>(${esc(storyline.suggested_tone)})</em>` : ''}</div>` : ''}
        ${(storyline.post_ideas && storyline.post_ideas.length) ? `<div class="content-field"><strong>Post ideas:</strong><ul>${storyline.post_ideas.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
      </div>

      ${doNotSay.length ? `
        <div class="content-warning">
          <div class="content-warning-title"><i class="bi bi-exclamation-octagon"></i> Do not say</div>
          <ul>${doNotSay.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
        </div>` : ''}
    </div>
  `;
}

export function renderRawPostsFallback(posts, note) {
  if (!posts.length) {
    return `<div class="empty-block"><div class="empty-block-icon"><i class="bi bi-inbox"></i></div><div class="empty-block-text">${esc(note)}</div></div>`;
  }
  const byChannel = {};
  posts.forEach(p => { (byChannel[p.channel] = byChannel[p.channel] || []).push(p); });
  return `
    <div class="content-provenance" style="margin-bottom:10px;"><i class="bi bi-info-circle"></i> ${esc(note)}</div>
    <div class="chip-row">
      ${Object.entries(byChannel).map(([ch, arr]) => `<span class="chip"><i class="bi ${CHANNEL_ICON[ch] || 'bi-globe2'}"></i> ${CHANNEL_LABEL[ch] || ch}: ${arr.length}</span>`).join('')}
    </div>
  `;
}
