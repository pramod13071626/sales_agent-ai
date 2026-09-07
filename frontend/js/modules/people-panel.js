import { state } from './state.js';
import { el, dashPeople } from './dom.js';
import { esc, initials, getPersonasFor, getTechFor } from './utils.js';
import { showToast } from './toast.js';
import { hasDossier, openContactDrawer } from './contact-drawer.js';
import { renderSelection } from './selection.js';

export function renderContactsList(personas) {
  state.currentPersonas = personas;
  if (!personas.length) return '<div class="people-empty">No contacts match.</div>';
  return personas.slice(0, 12).map((p, idx) => {
    const tag = p.tier || p.decision_authority || (p.departments && p.departments[0]) || null;
    const dossierReady = hasDossier(p);
    return `
      <div class="contact-card">
        <button type="button" class="contact-main" data-contact-idx="${idx}" title="View full contact details">
          <div class="contact-avatar">${esc(initials(p.name))}</div>
          <div class="contact-body">
            <div class="contact-name">${esc(p.name || 'Unnamed')} ${dossierReady ? '<i class="bi bi-stars dossier-badge" title="AI call-prep dossier available"></i>' : ''}</div>
            <div class="contact-title">${esc(p.title || 'Title unknown')}</div>
            ${tag ? `<div class="contact-tags"><span class="tag">${esc(tag)}</span></div>` : ''}
          </div>
          <span class="contact-chevron"><i class="bi bi-chevron-right"></i></span>
        </button>
        <div class="contact-actions">
          <a class="icon-btn ${p.email ? '' : 'disabled'}" ${p.email ? `href="mailto:${esc(p.email)}"` : ''} title="${p.email ? 'Email ' + esc(p.name) : 'No email on file'}"><i class="bi bi-envelope"></i></a>
          <a class="icon-btn ${p.phone ? '' : 'disabled'}" ${p.phone ? `href="tel:${esc(p.phone)}"` : ''} title="${p.phone ? 'Call ' + esc(p.name) : 'No phone on file'}"><i class="bi bi-telephone"></i></a>
          <a class="icon-btn ${p.linkedin_url ? '' : 'disabled'}" ${p.linkedin_url ? `href="${esc(p.linkedin_url)}" target="_blank"` : ''} title="${p.linkedin_url ? 'LinkedIn' : 'No LinkedIn on file'}"><i class="bi bi-linkedin"></i></a>
        </div>
      </div>`;
  }).join('') + (personas.length > 12 ? `<div class="people-empty">+${personas.length - 12} more contacts — refine your search to narrow it down</div>` : '');
}

export function filterContacts(personas, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return personas;
  return personas.filter(p => (p.name || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));
}

export function renderPeople(account, lob) {
  const personas = getPersonasFor(account, lob);
  state.allAccountPersonas = personas;
  const tech = getTechFor(account, lob);

  const socialLinks = [
    account.linkedin_url ? { label: 'LinkedIn', icon: 'bi-linkedin', url: account.linkedin_url } : null,
    account.twitter_url ? { label: 'X / Twitter', icon: 'bi-twitter-x', url: account.twitter_url } : (account.twitter_handle ? { label: 'X / Twitter', icon: 'bi-twitter-x', url: `https://twitter.com/${account.twitter_handle}` } : null),
    account.blog_url ? { label: 'Blog', icon: 'bi-journal-richtext', url: account.blog_url } : null,
    account.github_url ? { label: 'GitHub', icon: 'bi-github', url: account.github_url } : null,
    account.glassdoor_url ? { label: 'Glassdoor', icon: 'bi-building', url: account.glassdoor_url } : null,
    account.website_url ? { label: 'Website', icon: 'bi-globe2', url: account.website_url } : null
  ].filter(Boolean);

  return `
    <!-- Key Contacts Section -->
    <div class="panel-title" style="margin-top:2px;">
      <span><i class="bi bi-person-lines-fill"></i> Key Contacts</span>
      <span class="context-badge live">${personas.length} mapped</span>
    </div>
    <p class="section-desc" style="margin-bottom:8px;">Executive stakeholders &amp; decision makers. Click any card to open the AI Call-Prep Dossier.</p>

    <div class="contact-search">
      <i class="bi bi-search"></i>
      <input type="text" id="contactSearchInput" placeholder="Filter contacts by name or title..." autocomplete="off">
    </div>
    <div id="contactsListContainer">${renderContactsList(personas)}</div>

    <!-- Social & Web Footprint Section -->
    <div class="panel-title" style="margin-top:18px;">
      <span><i class="bi bi-globe"></i> Social &amp; Web Footprint</span>
    </div>
    <p class="section-desc" style="margin-bottom:8px;">Verified corporate web properties and active public discourse channels.</p>
    ${socialLinks.length ? `<div class="social-links">${socialLinks.map(s => `<a class="social-link" href="${esc(s.url)}" target="_blank" title="Open ${esc(s.label)} profile"><i class="bi ${s.icon}"></i> ${esc(s.label)}</a>`).join('')}</div>`
      : '<div class="people-empty">No social/web links on file.</div>'}

    <!-- Detected Tech Stack Section -->
    <div class="panel-title" style="margin-top:18px;">
      <span><i class="bi bi-cpu-fill"></i> Detected Tech Stack</span>
      <span class="context-badge ai">${tech.length} items</span>
    </div>
    <p class="section-desc" style="margin-bottom:8px;">Technologies, frameworks, and cloud platforms detected across operating segments.</p>
    <div class="chip-row" style="margin-bottom:12px;">
      ${tech.length ? tech.map(t => `<span class="chip" title="Active technology in stack"><i class="bi bi-cpu"></i> ${esc(t)}</span>`).join('') : '<span class="chip">No tech stack detected yet</span>'}
    </div>

    <!-- Quick Actions Section -->
    <div class="panel-title" style="margin-top:18px;">
      <span><i class="bi bi-tools"></i> Account Actions</span>
    </div>
    <p class="section-desc" style="margin-bottom:8px;">Enrich tech telemetry or navigate to the deep Account Explorer pipeline.</p>
    <button type="button" class="action-btn" id="fetchDiffbotBtn" data-acct="${account.id}" title="Run live Diffbot scraping to identify technologies and company attributes"><i class="bi bi-cloud-arrow-down"></i> Enrich with Diffbot Intel</button>
    <button type="button" class="action-btn secondary" id="openExplorerBtn" data-name="${esc(account.name)}" title="Jump to Account Explorer for deep scraping workflow"><i class="bi bi-box-arrow-up-right"></i> Open in Account Explorer</button>
  `;
}

dashPeople.addEventListener('input', function (e) {
  if (e.target.id !== 'contactSearchInput') return;
  const filtered = filterContacts(state.allAccountPersonas, e.target.value);
  el('contactsListContainer').innerHTML = renderContactsList(filtered);
});

dashPeople.addEventListener('click', async function (e) {
  const contactBtn = e.target.closest('[data-contact-idx]');
  if (contactBtn) {
    const p = state.currentPersonas[Number(contactBtn.dataset.contactIdx)];
    if (p) openContactDrawer(p);
    return;
  }
  const diffbotBtn = e.target.closest('#fetchDiffbotBtn');
  if (diffbotBtn) {
    const account = state.accounts.find(a => a.id === Number(diffbotBtn.dataset.acct));
    if (!account) return;
    diffbotBtn.disabled = true;
    diffbotBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Fetching…';
    try {
      const res = await fetch('/api/account/diffbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: account.name, target_url: account.website_url || null })
      });
      if (!res.ok) throw new Error('Diffbot request failed');
      const data = await res.json();
      const techs = (data.technologies || []).filter(Boolean);
      if (techs.length) {
        state.extraTech[account.id] = [...new Set([...(state.extraTech[account.id] || []), ...techs])];
        showToast(`Diffbot found ${techs.length} technolog${techs.length === 1 ? 'y' : 'ies'} for ${account.name}`);
      } else {
        showToast(`Diffbot returned no new technology data for ${account.name}`);
      }
    } catch (err) {
      console.error(err);
      showToast('Diffbot lookup failed. Check the API server logs.');
    } finally {
      renderSelection();
    }
    return;
  }
  const explorerBtn = e.target.closest('#openExplorerBtn');
  if (explorerBtn) {
    try { await navigator.clipboard.writeText(explorerBtn.dataset.name); } catch (err) { /* clipboard permission denied — non-critical */ }
    showToast('Account name copied — paste it into the Explorer search bar');
    window.open('/pipline/', '_blank');
  }
});
