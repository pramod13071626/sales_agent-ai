// Shimmer/skeleton placeholders shown while a section's real content is still
// loading — originally just digest.js's six dynamic sections (see its
// IntersectionObserver-based lazy render), now shared by any card/panel/list
// loading state across the app instead of a plain spinner or "Loading…" text.
export function renderSkeleton(kind) {
  if (kind === 'lines') {
    return `
      <div class="skeleton-block">
        <div class="skeleton skeleton-line skeleton-line--100"></div>
        <div class="skeleton skeleton-line skeleton-line--80"></div>
        <div class="skeleton skeleton-line skeleton-line--100"></div>
        <div class="skeleton skeleton-line skeleton-line--60"></div>
      </div>`;
  }
  if (kind === 'list-rows') {
    return `
      <div class="skeleton-block">
        <div class="skeleton skeleton-list-row"></div>
        <div class="skeleton skeleton-list-row"></div>
        <div class="skeleton skeleton-list-row"></div>
      </div>`;
  }
  if (kind === 'nav-cards') {
    // Left-nav account list (partials/nav.html) — matches .nav-account-card's
    // avatar + name/badge row + subtitle line.
    const card = `
      <div class="skeleton-nav-card">
        <div class="skeleton-nav-card-top">
          <div class="skeleton skeleton-avatar"></div>
          <div class="skeleton skeleton-line"></div>
        </div>
        <div class="skeleton skeleton-line skeleton-line--60"></div>
      </div>`;
    return `<div class="skeleton-block">${card.repeat(4)}</div>`;
  }
  if (kind === 'feed-rows') {
    // <li> rows for <ul>-based Command Center panels (cc-feed-row /
    // cc-drawer-empty lists) — an <li> itself, not wrapped in a <div>, so it
    // stays valid sitting directly inside the panel's <ul>.
    const row = `
      <li class="skeleton-feed-row">
        <div class="skeleton skeleton-line skeleton-line--80"></div>
        <div class="skeleton skeleton-line skeleton-line--60"></div>
      </li>`;
    return row.repeat(3);
  }
  if (kind === 'chart') {
    // Canvas-based panels (e.g. the Account Priority Matrix bubble chart).
    return `<div class="skeleton skeleton-chart"></div>`;
  }
  // 'cards' (default)
  return `
    <div class="skeleton-block">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>`;
}
