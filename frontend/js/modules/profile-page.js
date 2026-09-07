// Entry point for the standalone full-page contact profile (opened via the
// contact drawer's "View Profile" button, see contact-drawer.js). Fetches
// its own account/persona/content data — it doesn't share the main
// dashboard's in-memory state, since it always opens in a new tab — then
// renders every section as its own full-width widget via full-profile.js.
import { state } from './state.js';
import { el } from './dom.js';
import { renderFullProfile } from './full-profile.js';
import { wireProfilePdfDownload } from './contact-pdf.js';

async function init() {
  const params = new URLSearchParams(window.location.search);
  const accountId = parseInt(params.get('account'), 10);
  const personaId = parseInt(params.get('persona_id'), 10);
  const main = el('profilePageMain');
  const backLink = el('profilePageBack');

  if (!accountId || !personaId) {
    main.innerHTML = `<div class="profile-page-error">Missing or invalid link — this page needs both an account and a contact to show.</div>`;
    return;
  }

  backLink.href = `/?account=${encodeURIComponent(accountId)}`;

  try {
    const [acctRes, contentRes] = await Promise.all([
      fetch(`/api/accounts/${accountId}`),
      fetch(`/api/accounts/${accountId}/content`).catch(() => null)
    ]);
    if (!acctRes.ok) throw new Error(`Account fetch failed (${acctRes.status})`);
    const account = await acctRes.json();

    if (contentRes && contentRes.ok) {
      const content = await contentRes.json();
      Object.assign(state.contentStore.digests, content.digests || {});
      Object.assign(state.contentStore.posts, content.posts || {});
      Object.assign(state.contentStore.jobs, content.jobs || {});
    }

    const persona = (account.personas || []).find(p => p.id === personaId);
    if (!persona) {
      main.innerHTML = `<div class="profile-page-error">This contact could not be found on ${account.name || 'this account'} — they may have been removed or merged since this link was created.</div>`;
      return;
    }

    document.title = `${persona.name || 'Contact'} — Full Profile`;
    el('profilePageTitle').textContent = document.title;

    state.activeAccountId = accountId;
    main.innerHTML = renderFullProfile(persona);
    wireProfilePdfDownload(main, persona);
  } catch (err) {
    console.error('Failed to load contact profile', err);
    main.innerHTML = `<div class="profile-page-error">Could not load this profile — ${err.message}. Try reopening it from the dashboard.</div>`;
  }
}

init();
