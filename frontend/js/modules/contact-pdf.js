// "Download PDF" for a contact — generated server-side (see the
// GET /api/personas/{id}/profile.pdf route in api.py, built with ReportLab)
// rather than a client-side screenshot capture, so the PDF has real
// selectable text, proper pagination, and can include the full digest/post
// history regardless of what's currently rendered on screen.
import { showToast } from './toast.js';
import { slugify } from './utils.js';

export async function triggerPersonaPdfDownload(persona) {
  if (!persona || persona.id == null) {
    showToast('Cannot generate PDF — this contact has no id.');
    return;
  }
  showToast('Generating PDF…');
  try {
    // A plain <a href> navigation can't carry the Authorization header this
    // endpoint now requires (see AUTH_JWT_IMPLEMENTATION_PLAN.md) — fetch()
    // goes through fetch-instrumentation.js's patched window.fetch, which
    // attaches it, then we hand the browser the resulting blob to save.
    const res = await fetch(`/api/personas/${persona.id}/profile.pdf`);
    if (res.status === 401) {
      showToast('Your session expired — please sign in again.');
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    if (res.status === 403) {
      showToast("You don't have access to this account's PDF.");
      return;
    }
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(persona.name || 'contact')}-personality-report.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('PDF download failed', err);
    showToast('Could not generate the PDF — see console for details.');
  }
}

// Convenience for pages (full-profile.js) that render the button into a
// container they control directly, rather than through contact-drawer.js's
// own delegated click listener.
export function wireProfilePdfDownload(container, persona) {
  const btn = container.querySelector('#drawerDownloadPdfBtn');
  if (btn) btn.addEventListener('click', () => triggerPersonaPdfDownload(persona));
}
