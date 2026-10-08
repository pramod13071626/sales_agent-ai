// Persona profile photos in place of initials avatars.
//
// Render sites only add an attribute — `${photoAttr(p)}` on the avatar element — and
// this module does the rest for every page that imports it: when a marked avatar
// scrolls into view it fetches GET /api/personas/{id}/photo (a server-side cached copy,
// since scraped LinkedIn URLs expire) and swaps the initials for the image. No photo,
// or any error, leaves the initials exactly as rendered.
// The photo is fetched with fetch() rather than <img src> because API auth is a bearer
// token held in JS memory (fetch-instrumentation.js adds it), not a cookie.

const photoCache = new Map();   // persona id -> Promise<objectURL | null>

/** Attribute string for an avatar element. Skips personas known to have no photo. */
export function photoAttr(p, id = p && (p.id ?? p.persona_id)) {
  if (!id || (p && p.has_photo === false)) return '';
  return `data-persona-photo="${Number(id)}"`;
}

function loadPhoto(id) {
  if (!photoCache.has(id)) {
    photoCache.set(id, fetch(`/api/personas/${id}/photo`)
      .then(res => (res.ok ? res.blob() : null))
      .then(blob => (blob && blob.type.startsWith('image/') ? URL.createObjectURL(blob) : null))
      .catch(() => null));
  }
  return photoCache.get(id);
}

async function hydrate(el) {
  const id = Number(el.dataset.personaPhoto);
  const url = id ? await loadPhoto(id) : null;
  if (!url || !el.isConnected) return;
  const img = document.createElement('img');
  img.className = 'persona-photo-img';
  img.alt = '';
  img.src = url;
  img.onload = () => {
    el.classList.add('has-persona-photo');
    el.replaceChildren(img);
  };
}

const visible = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      visible.unobserve(e.target);
      hydrate(e.target);
    }
  }, { rootMargin: '200px' })
  : null;

function watch(root) {
  const els = root.matches?.('[data-persona-photo]') ? [root] : [];
  root.querySelectorAll?.('[data-persona-photo]').forEach(el => els.push(el));
  for (const el of els) {
    if (el.dataset.photoWatched) continue;
    el.dataset.photoWatched = '1';
    visible ? visible.observe(el) : hydrate(el);
  }
}

function injectStyles() {
  if (document.getElementById('personaPhotoStyles')) return;
  const style = document.createElement('style');
  style.id = 'personaPhotoStyles';
  style.textContent = `
    .has-persona-photo { padding: 0 !important; overflow: hidden; background: none !important; }
    .persona-photo-img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }`;
  document.head.appendChild(style);
}

function init() {
  injectStyles();
  watch(document.body);
  new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1) watch(n); });
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.body) init();
else document.addEventListener('DOMContentLoaded', init, { once: true });
