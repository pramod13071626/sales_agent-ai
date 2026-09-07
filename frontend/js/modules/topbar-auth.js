// Small topbar widget: "Sign In" link when logged out, or the user's email
// + an Admin link (super_admin only) + Logout when logged in. Not enforced
// anywhere yet (AUTH_ENFORCED=false server-side, see
// AUTH_JWT_IMPLEMENTATION_PLAN.md §9) — this just makes the feature
// discoverable and usable while that's the case.
import { esc } from './utils.js';
import { getCurrentUser, logout, refreshAccessToken } from './auth-client.js';

function render() {
  const el = document.getElementById('topbarAuthWidget');
  if (!el) return;
  const user = getCurrentUser();

  if (!user) {
    el.innerHTML = `<a href="/login" class="topbar-link"><i class="bi bi-box-arrow-in-right"></i> Sign In</a>`;
    return;
  }

  el.innerHTML = `
    ${user.role === 'super_admin' ? '<a href="/admin" class="topbar-link"><i class="bi bi-people"></i> Admin</a>' : ''}
    <span class="topbar-auth-user" title="${esc(user.email)}"><i class="bi bi-person-circle"></i> ${esc(user.full_name || user.email)}</span>
    <button type="button" id="topbarLogoutBtn" class="topbar-link topbar-link-btn"><i class="bi bi-box-arrow-right"></i> Logout</button>
  `;
  document.getElementById('topbarLogoutBtn').addEventListener('click', async () => {
    await logout();
    window.location.href = '/login';
  });
}

export async function initTopbarAuth() {
  await refreshAccessToken(); // silent — restores a session from the refresh cookie on page load
  render();
  return getCurrentUser();
}
