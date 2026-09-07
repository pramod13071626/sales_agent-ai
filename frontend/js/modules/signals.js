import { esc, dedupePersonas, tierLabel } from './utils.js';
import { renderOrgChart } from './org-chart.js';

export function renderEngagementPanel(account) {
  const rows = [];
  if (account.trend_score_90d != null) {
    const t = account.trend_score_90d;
    const pct = Math.max(0, Math.min(100, (t + 100) / 2));
    rows.push({ label: '90-Day Trend Score', value: `${t > 0 ? '+' : ''}${t}`, pct, color: t >= 0 ? 'var(--success)' : 'var(--danger)' });
  }
  if (account.global_traffic_rank != null) {
    rows.push({ label: 'Global Traffic Rank', value: `#${Number(account.global_traffic_rank).toLocaleString()}` });
  }
  if (account.monthly_visits != null) {
    rows.push({ label: 'Monthly Visits', value: Number(account.monthly_visits).toLocaleString() });
  }
  if (account.bounce_rate != null) {
    rows.push({ label: 'Bounce Rate', value: `${account.bounce_rate}%`, pct: Math.max(0, Math.min(100, account.bounce_rate)) });
  }
  if (account.visit_duration != null) {
    rows.push({ label: 'Avg Visit Duration', value: `${account.visit_duration}s` });
  }
  if (account.page_views_per_visit != null) {
    rows.push({ label: 'Page Views / Visit', value: account.page_views_per_visit });
  }

  if (!rows.length) {
    return `<div class="empty-block">
      <div class="empty-block-icon"><i class="bi bi-graph-down"></i></div>
      <div class="empty-block-text">No engagement trend data yet. This needs a web-analytics source wired into the pipeline.</div>
    </div>`;
  }

  return rows.map(r => `
    <div class="stat-row">
      <span class="stat-label">${esc(r.label)}</span>
      <span class="stat-value">${esc(r.value)}</span>
    </div>
    ${r.pct != null ? `<div class="progress-track"><div class="progress-fill" style="width:${r.pct}%;${r.color ? `background:${r.color};` : ''}"></div></div>` : ''}
  `).join('');
}

export function computeSignals(account, lob) {
  const signals = [];
  const msi = account.multi_source_intelligence || {};

  if (msi.linkedin_metrics && msi.linkedin_metrics.follower_count) {
    const lm = msi.linkedin_metrics;
    signals.push({
      icon: 'bi-linkedin', text: `${Number(lm.follower_count).toLocaleString()} LinkedIn followers`,
      title: 'LinkedIn Snapshot',
      detail: `
        <div class="stat-row"><span class="stat-label">Followers</span><span class="stat-value">${Number(lm.follower_count).toLocaleString()}</span></div>
        ${lm.exact_employee_headcount ? `<div class="stat-row"><span class="stat-label">Employees (verified)</span><span class="stat-value">${Number(lm.exact_employee_headcount).toLocaleString()}</span></div>` : ''}
        ${(lm.specialties || []).length ? `<div class="dossier-label" style="margin-top:10px;">Specialties</div><div class="chip-row">${lm.specialties.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
        ${account.linkedin_url ? `<a class="social-link" style="margin-top:10px;" href="${esc(account.linkedin_url)}" target="_blank"><i class="bi bi-box-arrow-up-right"></i> Open LinkedIn profile</a>` : ''}
      `
    });
  }
  if (msi.linkedin_metrics && msi.linkedin_metrics.exact_employee_headcount) {
    signals.push({ icon: 'bi-people', text: `${Number(msi.linkedin_metrics.exact_employee_headcount).toLocaleString()} employees (verified via LinkedIn)` });
  }
  if (msi.sec_10k_chunks_meta && (msi.sec_10k_chunks_meta.sections_found || []).length) {
    const meta = msi.sec_10k_chunks_meta;
    signals.push({
      icon: 'bi-file-earmark-text', text: `Recent 10-K on file — ${meta.sections_found.join(', ')}`,
      title: 'SEC 10-K Filing',
      detail: `
        <div class="stat-row"><span class="stat-label">Accession number</span><span class="stat-value">${esc(meta.accession_number || '—')}</span></div>
        <div class="stat-row"><span class="stat-label">Sections available</span><span class="stat-value">${esc(meta.sections_found.join(', '))}</span></div>
        <div class="stat-row"><span class="stat-label">Chunks indexed</span><span class="stat-value">${esc(meta.total_chunks ?? '—')}</span></div>
        <button type="button" class="action-btn" id="fetchSecBtn" data-cik="${esc(account.sec_cik || '')}" style="margin-top:12px;">
          <i class="bi bi-cloud-arrow-down"></i> Fetch full filing text
        </button>
        <div id="secFetchResult"></div>
      `
    });
  }
  if (msi.gleif_intel && msi.gleif_intel.lei_code) {
    signals.push({
      icon: 'bi-patch-check', text: `LEI verified: ${msi.gleif_intel.lei_code} (${msi.gleif_intel.jurisdiction || 'jurisdiction unknown'})`,
      title: 'GLEIF Legal Entity Identity',
      detail: `
        <div class="stat-row"><span class="stat-label">Legal Entity Identifier</span><span class="stat-value">${esc(msi.gleif_intel.lei_code)}</span></div>
        <div class="stat-row"><span class="stat-label">Legal name</span><span class="stat-value">${esc(msi.gleif_intel.legal_name || account.legal_name || '—')}</span></div>
        <div class="stat-row"><span class="stat-label">Jurisdiction</span><span class="stat-value">${esc(msi.gleif_intel.jurisdiction || '—')}</span></div>
        <a class="social-link" style="margin-top:10px;" href="https://search.gleif.org/#/record/${encodeURIComponent(msi.gleif_intel.lei_code)}" target="_blank"><i class="bi bi-box-arrow-up-right"></i> View on GLEIF registry</a>
      `
    });
  }

  if (account.company_type === 'Public') {
    signals.push({
      icon: 'bi-graph-up-arrow', text: `Publicly traded — ${account.ticker || ''} on ${account.stock_exchange || 'a public exchange'}`,
      title: 'Public Market Listing',
      detail: `
        <div class="stat-row"><span class="stat-label">Ticker</span><span class="stat-value">${esc(account.ticker || '—')}</span></div>
        <div class="stat-row"><span class="stat-label">Exchange</span><span class="stat-value">${esc(account.stock_exchange || '—')}</span></div>
        <div class="stat-row"><span class="stat-label">Company type</span><span class="stat-value">${esc(account.company_type || '—')}</span></div>
      `
    });
  }
  if (account.last_funding_type) {
    const amt = account.total_funding_amount_usd ? `$${Number(account.total_funding_amount_usd).toLocaleString()}` : '—';
    const date = account.last_funding_date ? ` (${account.last_funding_date})` : '';
    signals.push({
      icon: 'bi-cash-coin', text: `Last funding: ${account.last_funding_type}${date}${account.total_funding_amount_usd ? ` — ${amt}` : ''}`,
      title: 'Funding History',
      detail: `
        <div class="stat-row"><span class="stat-label">Last funding type</span><span class="stat-value">${esc(account.last_funding_type)}</span></div>
        <div class="stat-row"><span class="stat-label">Date</span><span class="stat-value">${esc(account.last_funding_date || '—')}</span></div>
        <div class="stat-row"><span class="stat-label">Amount</span><span class="stat-value">${amt}</span></div>
        <div class="stat-row"><span class="stat-label">Funding rounds</span><span class="stat-value">${esc(account.num_funding_rounds ?? '—')}</span></div>
        <div class="stat-row"><span class="stat-label">Funding status</span><span class="stat-value">${esc(account.funding_status || '—')}</span></div>
      `
    });
  }
  if (account.ipo_status) {
    signals.push({
      icon: 'bi-bank2', text: `IPO status: ${account.ipo_status}`,
      title: 'IPO Status',
      detail: `
        <div class="stat-row"><span class="stat-label">Status</span><span class="stat-value">${esc(account.ipo_status)}</span></div>
        <div class="stat-row"><span class="stat-label">IPO date</span><span class="stat-value">${esc(account.ipo_date || '—')}</span></div>
      `
    });
  }
  if (account.patents_granted) {
    signals.push({ icon: 'bi-lightbulb', text: `${account.patents_granted} patent${account.patents_granted !== 1 ? 's' : ''} granted` });
  }
  if (account.active_tech_count) {
    const techSet = new Set();
    (account.lobs || []).forEach(l => (l.technologies || []).forEach(t => techSet.add(t)));
    signals.push({
      icon: 'bi-cpu', text: `${account.active_tech_count} active technologies detected${account.it_spend ? ` (IT spend: ${account.it_spend})` : ''}`,
      title: 'Technology Footprint',
      detail: `
        <div class="stat-row"><span class="stat-label">Active technologies</span><span class="stat-value">${esc(account.active_tech_count)}</span></div>
        ${account.it_spend ? `<div class="stat-row"><span class="stat-label">IT spend</span><span class="stat-value">${esc(account.it_spend)}</span></div>` : ''}
        ${techSet.size ? `<div class="dossier-label" style="margin-top:10px;">Detected across LOBs</div><div class="chip-row">${[...techSet].map(t => `<span class="chip"><i class="bi bi-cpu"></i> ${esc(t)}</span>`).join('')}</div>` : ''}
      `
    });
  }
  if (account.num_acquisitions) {
    signals.push({ icon: 'bi-briefcase', text: `${account.num_acquisitions} acquisition${account.num_acquisitions !== 1 ? 's' : ''} on record` });
  }
  if ((account.lobs || []).length > 1) {
    signals.push({
      icon: 'bi-folder2', text: `${account.lobs.length} active lines of business tracked`,
      title: 'Lines of Business',
      detail: `<div class="chip-row">${account.lobs.map(l => `<button type="button" class="chip" style="cursor:pointer;border:1px solid var(--border-color);font-family:inherit;" data-jump-lob="${l.id}" data-jump-account="${account.id}">${esc(l.name)}</button>`).join('')}</div>`
    });
  }
  if (account.total_contacts_captured) {
    const tierCounts = {};
    dedupePersonas(account.personas || []).forEach(p => { const t = tierLabel(p); tierCounts[t] = (tierCounts[t] || 0) + 1; });
    signals.push({
      icon: 'bi-people-fill', text: `${account.total_contacts_captured} contacts mapped across the org`,
      title: 'Org Coverage',
      detail: `
        <div class="chip-row" style="margin-bottom:14px;">${Object.entries(tierCounts).map(([label, n]) => `<span class="chip">${esc(label)}: ${n}</span>`).join('')}</div>
        ${renderOrgChart(account)}
      `
    });
  }
  if ((account.industries || []).length) {
    signals.push({
      icon: 'bi-tag', text: `Operates in ${account.industries.slice(0, 3).join(', ')}`,
      title: 'Industries',
      detail: `<div class="chip-row">${account.industries.map(i => `<span class="chip"><i class="bi bi-tag"></i> ${esc(i)}</span>`).join('')}</div>`
    });
  }
  const competitors = new Set();
  (lob ? [lob] : (account.lobs || [])).forEach(l => (l.competitors || []).forEach(c => competitors.add(c)));
  if (competitors.size) {
    signals.push({
      icon: 'bi-shield-exclamation', text: `Competitors tracked: ${[...competitors].slice(0, 3).join(', ')}`,
      title: 'Competitive Landscape',
      detail: `<div class="chip-row">${[...competitors].map(c => `<span class="chip"><i class="bi bi-shield-exclamation"></i> ${esc(c)}</span>`).join('')}</div>`
    });
  }
  return signals;
}
