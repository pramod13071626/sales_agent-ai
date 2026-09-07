// "Download PDF" for a contact — generated server-side (see the
// GET /api/personas/{id}/profile.pdf route in api.py, built with ReportLab)
// rather than a client-side screenshot capture, so the PDF has real
// selectable text, proper pagination, and can include the full digest/post
// history regardless of what's currently rendered on screen.
import { showToast } from './toast.js';
import { slugify } from './utils.js';

export function triggerPersonaPdfDownload(persona) {
  if (!persona || persona.id == null) {
    showToast('Cannot generate PDF — this contact has no id.');
    return;
  }
  showToast('Generating PDF…');
  const a = document.createElement('a');
  a.href = `/api/personas/${persona.id}/profile.pdf`;
  a.download = `${slugify(persona.name || 'contact')}-personality-report.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Convenience for pages (full-profile.js) that render the button into a
// container they control directly, rather than through contact-drawer.js's
// own delegated click listener.
export function wireProfilePdfDownload(container, persona) {
  const btn = container.querySelector('#drawerDownloadPdfBtn');
  if (btn) btn.addEventListener('click', () => triggerPersonaPdfDownload(persona));
}
