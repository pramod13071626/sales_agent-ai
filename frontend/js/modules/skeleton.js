// Shimmer/skeleton placeholders shown while a digest section's real content is
// rendered (see digest.js's IntersectionObserver-based lazy render). Three shapes
// cover all six dynamic digest sections — no per-section bespoke skeleton needed.
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
  // 'cards' (default)
  return `
    <div class="skeleton-block">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>`;
}
