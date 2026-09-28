// On-demand "Generate" for the Sales Call-Prep & Battlecards widget on the
// standalone profile page (full-profile.js). Calls
// POST /api/personas/{id}/callprep/generate (services/callprep_service.py),
// which returns the refreshed persona, and re-renders the widget body in place.
// The server skips the LLM when this contact's inputs haven't changed since
// the last generation.
import { esc } from './utils.js';
import { hasCallPrep, renderDossierTabs } from './profile-render.js';

function buttonLabel(persona) {
  return hasCallPrep(persona)
    ? '<i class="fa-solid fa-rotate"></i> Regenerate'
    : '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate';
}

export function renderCallPrepButton(persona) {
  return `<button type="button" class="profile-action-btn btn-primary" id="generateCallPrepBtn"
    style="padding: 5px 12px; font-size: .8rem; font-weight: 600;"
    title="Generate AI call-prep and battlecards from this contact's captured data">${buttonLabel(persona)}</button>`;
}

function setStatus(statusEl, text, color) {
  if (!statusEl) return;
  statusEl.style.color = color || 'var(--text-muted)';
  statusEl.textContent = text;
}

async function handleClick(container, persona, btn) {
  const statusEl = container.querySelector('#callPrepStatus');
  const body = container.querySelector('[data-callprep-body]');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…';
  setStatus(statusEl, 'Building call-prep from captured career, posts and account signals — usually 10–40 seconds.');

  try {
    const res = await fetch(`/api/personas/${persona.id}/callprep/generate`, { method: 'POST' });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = {
        429: "Today's AI generation limit has been reached — please try again tomorrow.",
        502: 'The AI service is busy — please try again in a minute.',
      }[res.status] || `Couldn't generate call-prep: ${data.detail || res.status}`;
      setStatus(statusEl, msg, 'var(--danger)');
      return;
    }

    // Keep fields the profile page added client-side (e.g. company_name).
    Object.assign(persona, data.persona || {});
    if (body) body.innerHTML = renderDossierTabs(persona);
    setStatus(statusEl, data.status === 'unchanged'
      ? 'Already up to date — nothing new captured for this contact since the last generation.'
      : `Generated (evidence level ${esc(data.level || '?')}).`,
    data.status === 'unchanged' ? 'var(--text-muted)' : 'var(--success)');
  } catch (err) {
    console.error('Call-prep generation failed', err);
    setStatus(statusEl, "Couldn't reach the server — please check your connection and try again.", 'var(--danger)');
  } finally {
    btn.disabled = false;
    btn.innerHTML = buttonLabel(persona);
  }
}

// One-shot wiring for the standalone profile page (fresh container per load).
export function wireCallPrepGeneration(container, persona) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('#generateCallPrepBtn');
    if (btn && !btn.disabled) handleClick(container, persona, btn);
  });
}
