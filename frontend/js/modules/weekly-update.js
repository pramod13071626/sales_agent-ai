import { state } from './state.js';
import { el } from './dom.js';
import { esc, formatWeekOf, priorityPill, isDryRunDigest, resolveAccountTargetKey } from './utils.js';

export function getCurrentWeeklyEmail(account) {
  const key = resolveAccountTargetKey(account);
  const d = key ? state.contentStore.digests[key] : null;
  if (!d || isDryRunDigest(d) || !d.digest || !d.digest.email) return null;
  return { ...d.digest.email, generated_at: d.generated_at, target_key: key };
}

export function renderWeeklyEmailCard(email, opts) {
  opts = opts || {};
  if (!email) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-envelope"></i></div>
      <div class="empty-block-text">No weekly sales update email generated yet for this account.</div>
    </div>`;
  }
  return `
    <div class="weekly-email-card">
      <div class="weekly-email-header">
        <div>
          <div class="weekly-email-week">${opts.current ? 'This week' : esc(formatWeekOf(email.week_of || email.generated_at))}${email.generated_at ? ` <span class="weekly-email-date">· generated ${esc(formatWeekOf(email.generated_at))}</span>` : ''}</div>
          <div class="weekly-email-subject">${esc(email.subject || '(No subject)')}</div>
        </div>
        ${priorityPill(email.priority)}
      </div>
      <div class="weekly-email-body">${(email.body || '').split('\n').filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}</div>
      ${email.confidence ? `<div class="weekly-email-meta"><i class="bi bi-shield-check"></i> Confidence: ${esc(email.confidence)}</div>` : ''}
      ${(email.data_gaps || []).length ? `<details class="weekly-email-details"><summary>Data gaps (${email.data_gaps.length})</summary>${email.data_gaps.map(g => `<p>${esc(g)}</p>`).join('')}</details>` : ''}
      ${(email.do_not_say || []).length ? `<details class="weekly-email-details"><summary>Do not say (${email.do_not_say.length})</summary>${email.do_not_say.map(g => `<p>${esc(g)}</p>`).join('')}</details>` : ''}
    </div>`;
}

export function renderWeeklyUpdateHistoryList(pastOnly) {
  if (!pastOnly.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-archive"></i></div>
      <div class="empty-block-text">No past weekly updates archived yet — check back after next week's pipeline run.</div>
    </div>`;
  }
  return pastOnly.map(h => `
    <details class="weekly-email-archive-item">
      <summary>
        <span class="weekly-email-week">${esc(formatWeekOf(h.week_of))}</span>
        <span class="weekly-email-subject-sm">${esc(h.subject || '(No subject)')}</span>
        ${priorityPill(h.priority)}
      </summary>
      ${renderWeeklyEmailCard(h)}
    </details>`).join('');
}

export function renderWeeklyUpdateTab(account) {
  const current = getCurrentWeeklyEmail(account);
  const history = state.weeklyUpdateHistory[account.id] || [];
  const pastOnly = history.filter(h => h.generated_at !== (current ? current.generated_at : null));

  return `
    <div class="panel">
      <div class="panel-title">
        <span><i class="bi bi-envelope-paper-fill"></i> Sales Weekly Update Mail</span>
        <span class="context-badge ai"><i class="bi bi-stars"></i> LLM Generated</span>
      </div>
      <p class="section-desc">Auto-generated weekly sales briefing email for this account, regenerated on every pipeline run.</p>
      <div id="weeklyUpdateCurrentBody">${renderWeeklyEmailCard(current, { current: true })}</div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <span><i class="bi bi-clock-history"></i> Past Weekly Updates</span>
        <span class="context-badge live">${pastOnly.length} archived</span>
      </div>
      <p class="section-desc">Previously generated weekly update emails, preserved here even after a newer version replaces the live one above.</p>
      <div id="weeklyUpdateHistoryBody">${renderWeeklyUpdateHistoryList(pastOnly)}</div>
    </div>
  `;
}

// Archives the current week's sales update email (if any) into permanent history, then
// repaints the tab with the merged current + past-weeks view.
export async function syncWeeklyUpdate(account) {
  const email = getCurrentWeeklyEmail(account);
  if (!email || !email.generated_at) return;
  let data = null;
  try {
    const res = await fetch(`/api/accounts/${account.id}/weekly-updates/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_key: email.target_key,
        generated_at: email.generated_at,
        subject: email.subject, body: email.body,
        priority: email.priority, confidence: email.confidence,
        data_gaps: email.data_gaps || [], do_not_say: email.do_not_say || []
      })
    });
    if (res.ok) data = await res.json();
  } catch (err) {
    console.error('Weekly update sync failed', err);
    return;
  }
  if (!data) return;
  state.weeklyUpdateHistory[account.id] = data.updates;
  if (state.activeAccountId === account.id && state.activeSalesTab === 'weekly') {
    const currentBody = el('weeklyUpdateCurrentBody');
    const histBody = el('weeklyUpdateHistoryBody');
    const pastOnly = data.updates.filter(h => h.generated_at !== email.generated_at);
    if (currentBody) currentBody.innerHTML = renderWeeklyEmailCard(email, { current: true });
    if (histBody) histBody.innerHTML = renderWeeklyUpdateHistoryList(pastOnly);
    const badge = document.querySelector('#salesTabsNav [data-tab="weekly"] .tab-badge');
    if (badge) badge.textContent = data.updates.length;
  }
}
