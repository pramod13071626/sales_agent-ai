// On-demand "Generate now" for the Executive Personality/Psychological
// Profile widgets (profile-render.js's renderPlaceholderProfile) — used by
// both the standalone profile page (full-profile.js) and the contact
// drawer (contact-drawer.js). Both profiles come from the same server-side
// digest subprocess run (--profiles-only in api.py's
// _generate_persona_profiles), so a successful generate on either button
// refreshes both widgets in place.
import { state } from './state.js';
import { resolvePersonaTargetKey } from './utils.js';
import { renderFullPersonalityProfile, renderFullPsychologicalProfile, renderProfileDownloadBtn } from './profile-render.js';

const PROFILE_KINDS = {
  generatePersonalityProfileBtn: {
    endpoint: 'personality-profile',
    digestKey: 'personality_profile',
    label: 'Personality',
  },
  generatePsychologicalProfileBtn: {
    endpoint: 'psychological-profile',
    digestKey: 'psychological_profile',
    label: 'Psychological',
  },
};

function friendlyGenerateError(status, detail) {
  if (status === 429) {
    // OpenRouter's free-tier quota resets at 00:00 UTC — show that in local time.
    const reset = new Date();
    reset.setUTCHours(24, 0, 0, 0);
    return `The AI service's daily request limit has been reached — please try again after ${reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Your captured content below is fine.`;
  }
  if (/isn.t registered/i.test(detail || '')) {
    return "This contact isn't tracked for content capture yet — see the checklist below.";
  }
  if (status === 400) {
    return "No captured content is connected for this contact yet — please add/connect their social activity (LinkedIn, X, News) before generating this profile.";
  }
  if (status === 500 || /produced no/i.test(detail || '')) {
    return "Not enough captured content is available yet to generate this profile — please provide content (recent posts/activity) for this contact, then try again.";
  }
  if (status === 502) {
    return "Generation failed while synthesizing this profile — please try again in a moment.";
  }
  return "Couldn't generate this profile right now — please try again in a moment.";
}

function setButtonBusy(btn, busy) {
  btn.disabled = busy;
  btn.innerHTML = busy
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Generating…'
    : '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate now';
}

// Returns true if the click was a generate-profile click and was handled —
// mirrors action-items.js's handleActionItemClick(e, account) shape so a
// caller with its own persistent delegated listener (contact-drawer.js,
// whose drawer DOM is reused across multiple openContactDrawer() calls) can
// call this directly instead of attaching a second listener each time the
// drawer reopens. Containers with no listener of their own should use
// wireProfileGeneration() below instead.
export async function handleGenerateProfileClick(e, container, persona) {
  const btn = e.target.closest('[data-generate-profile]');
  if (!btn) return false;
  const kind = PROFILE_KINDS[btn.id];
  if (!kind || !persona || persona.id == null) return false;

  const statusEl = container.querySelector(`#${btn.id}Status`);
  setButtonBusy(btn, true);
  if (statusEl) {
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = `Generating the ${kind.label} Profile from captured public activity — this can take a few minutes. Feel free to check back shortly.`;
  }

  try {
    const res = await fetch(`/api/personas/${persona.id}/${kind.endpoint}/generate`, { method: 'POST' });

    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return true;
    }

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setButtonBusy(btn, false);
      if (statusEl) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = friendlyGenerateError(res.status, body.detail);
      }
      return true;
    }

    // Same subprocess run produces BOTH profiles — merge whichever came
    // back into local state so re-rendering either widget reflects it.
    const targetKey = resolvePersonaTargetKey(persona);
    if (targetKey) {
      const existing = state.contentStore.digests[targetKey] || {};
      state.contentStore.digests[targetKey] = {
        ...existing,
        digest: { ...(existing.digest || {}), [kind.digestKey]: body.profile },
      };
    }
    const digestEntry = targetKey ? state.contentStore.digests[targetKey] : null;

    const personalityWrap = container.querySelector('[data-profile-widget="personality"]');
    if (personalityWrap) personalityWrap.innerHTML = renderFullPersonalityProfile(digestEntry, persona);

    const psychWrap = container.querySelector('[data-profile-widget="psychological"]');
    if (psychWrap) psychWrap.innerHTML = renderFullPsychologicalProfile(digestEntry, persona);

    // Download buttons only render once their profile exists — show them now.
    container.querySelectorAll('[data-profile-download]').forEach(slot => {
      slot.innerHTML = renderProfileDownloadBtn(slot.dataset.profileDownload, digestEntry);
    });
  } catch (err) {
    console.error('Profile generation failed', err);
    setButtonBusy(btn, false);
    if (statusEl) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = "Couldn't reach the server — please check your connection and try again.";
    }
  }
  return true;
}

// One-shot wiring for a container with no delegated listener of its own
// (the standalone profile page, opened fresh per page load). Do NOT call
// this more than once for the same persistent container — it attaches a
// new listener every call. A container reused across multiple renders
// (like the contact drawer) should call handleGenerateProfileClick directly
// from its own existing delegated listener instead — see contact-drawer.js.
export function wireProfileGeneration(container, persona) {
  container.addEventListener('click', (e) => { handleGenerateProfileClick(e, container, persona); });
}
