// Small topbar widget: "Sign In" link when logged out, or the user's email
// + an Admin link (super_admin only) + a "My Tasks" cross-account action-item
// count + Logout when logged in. Not enforced anywhere yet (AUTH_ENFORCED=false
// server-side, see AUTH_JWT_IMPLEMENTATION_PLAN.md §9) — this just makes the
// feature discoverable and usable while that's the case.
import { esc } from './utils.js';
import { getCurrentUser, logout, refreshAccessToken } from './auth-client.js';
import { renderMyTasksPanel } from './action-items.js';
import { myTasksDrawer, myTasksDrawerBackdrop, myTasksDrawerBody } from './dom.js';

function openMyTasksDrawer() {
  myTasksDrawerBody.innerHTML = '<div class="empty-block-text" style="padding:16px 4px;">Loading…</div>';
  myTasksDrawer.classList.add('open');
  myTasksDrawerBackdrop.classList.add('open');
}

function closeMyTasksDrawer() {
  myTasksDrawer.classList.remove('open');
  myTasksDrawerBackdrop.classList.remove('open');
}

document.getElementById('myTasksDrawerClose').addEventListener('click', closeMyTasksDrawer);
myTasksDrawerBackdrop.addEventListener('click', closeMyTasksDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMyTasksDrawer(); });

function render() {
  const el = document.getElementById('topbarAuthWidget');
  if (!el) return;
  const user = getCurrentUser();

  if (!user) {
    el.innerHTML = `<a href="/login" class="topbar-link"><i class="bi bi-box-arrow-in-right"></i> Sign In</a>`;
    return;
  }

  const showTasks = user.role === 'super_admin' || user.has_tasks_access !== false;

  el.innerHTML = `
    ${user.role === 'super_admin' ? '<a href="/admin" class="topbar-link"><i class="bi bi-people"></i> Admin</a>' : ''}
    ${showTasks ? '<button type="button" id="topbarMyTasksBtn" class="topbar-link topbar-link-btn"><i class="bi bi-list-check"></i> My Tasks <span class="tab-badge" id="topbarMyTasksBadge">…</span></button>' : ''}
    <span class="topbar-auth-user" title="${esc(user.email)}"><i class="bi bi-person-circle"></i> ${esc(user.full_name || user.email)}</span>
    <button type="button" id="topbarLogoutBtn" class="topbar-link topbar-link-btn"><i class="bi bi-box-arrow-right"></i> Logout</button>
  `;
  document.getElementById('topbarLogoutBtn').addEventListener('click', async () => {
    await logout();
    window.location.href = '/login';
  });
  if (showTasks) {
    const tasksBtn = document.getElementById('topbarMyTasksBtn');
    if (tasksBtn) {
      tasksBtn.addEventListener('click', async () => {
        openMyTasksDrawer();
        const html = await renderMyTasksPanel();
        myTasksDrawerBody.innerHTML = html;
        refreshMyTasksBadge();
      });
      refreshMyTasksBadge();
    }
  }
}

async function refreshMyTasksBadge() {
  const badge = document.getElementById('topbarMyTasksBadge');
  if (!badge) return;
  try {
    const res = await fetch('/api/me/action-items');
    if (!res.ok) return;
    const data = await res.json();
    const open = (data.action_items || []).filter(i => i.status !== 'done' && i.status !== 'cancelled');
    badge.textContent = open.length;
  } catch (err) {
    console.error('Failed to load My Tasks count', err);
  }
}

export async function initTopbarAuth() {
  await refreshAccessToken(); // silent — restores a session from the refresh cookie on page load
  render();
  return getCurrentUser();
}
