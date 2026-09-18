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
  const drawer = document.getElementById('myTasksDrawer');
  const backdrop = document.getElementById('myTasksDrawerBackdrop');
  const body = document.getElementById('myTasksDrawerBody');
  if (!drawer || !backdrop || !body) return;
  body.innerHTML = '<div class="empty-block-text" style="padding:16px 4px;">Loading…</div>';
  drawer.classList.add('open');
  backdrop.classList.add('open');
}

function closeMyTasksDrawer() {
  const drawer = document.getElementById('myTasksDrawer');
  const backdrop = document.getElementById('myTasksDrawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

document.getElementById('myTasksDrawerClose')?.addEventListener('click', closeMyTasksDrawer);
document.getElementById('myTasksDrawerBackdrop')?.addEventListener('click', closeMyTasksDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMyTasksDrawer(); });

function getUserInitials(user) {
  if (!user) return 'U';
  if (user.full_name) {
    const parts = user.full_name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  }
  if (user.email) {
    return user.email.substring(0, 2).toUpperCase();
  }
  return 'U';
}

function render() {
  const el = document.getElementById('topbarAuthWidget');
  if (!el) return;
  const user = getCurrentUser();

  if (!user) {
    el.innerHTML = `<a href="/login" class="topbar-link"><i class="bi bi-box-arrow-in-right"></i> Sign In</a>`;
    return;
  }

  const isOnAdminPage = window.location.pathname.startsWith('/admin');
  const showTasks = !isOnAdminPage && (user.role === 'super_admin' || user.has_tasks_access !== false);
  const displayName = user.full_name || (user.email ? user.email.split('@')[0] : 'User');
  const initials = getUserInitials(user);
  const isSuperAdmin = user.role === 'super_admin';

  el.innerHTML = `
    ${showTasks ? '<button type="button" id="topbarMyTasksBtn" class="topbar-link topbar-link-btn" title="View assigned action items"><i class="bi bi-list-check"></i> My Tasks <span class="tab-badge" id="topbarMyTasksBadge">…</span></button>' : ''}
    
    <div class="topbar-profile-container" id="topbarProfileContainer">
      <button type="button" class="topbar-profile-btn" id="topbarProfileBtn" aria-expanded="false" aria-haspopup="true" title="User profile for ${esc(displayName)}">
        <div class="topbar-profile-avatar">${esc(initials)}</div>
        <span class="topbar-profile-label">${esc(displayName)}</span>
        <i class="bi bi-chevron-down topbar-profile-arrow"></i>
      </button>

      <div class="topbar-profile-dropdown" id="topbarProfileDropdown" role="menu">
        <div class="profile-dropdown-header">
          <div class="profile-dropdown-avatar">${esc(initials)}</div>
          <div class="profile-dropdown-info">
            <div class="profile-dropdown-name" title="${esc(displayName)}">${esc(displayName)}</div>
            <div class="profile-dropdown-email" title="${esc(user.email || '')}">${esc(user.email || '')}</div>
          </div>
        </div>

        <div class="profile-dropdown-role-row">
          <span class="profile-role-tag ${isSuperAdmin ? 'role-super-admin' : 'role-user'}">
            <i class="bi ${isSuperAdmin ? 'bi-shield-check' : 'bi-person-badge'}"></i>
            ${isSuperAdmin ? 'Super Admin' : 'User'}
          </span>
        </div>

        <div class="profile-dropdown-divider"></div>

        <button type="button" class="profile-dropdown-item profile-dropdown-logout" id="topbarLogoutBtn" role="menuitem">
          <i class="bi bi-box-arrow-right"></i>
          <span>Logout</span>
        </button>
      </div>
    </div>
  `;

  const profileBtn = document.getElementById('topbarProfileBtn');
  const profileDropdown = document.getElementById('topbarProfileDropdown');
  const profileContainer = document.getElementById('topbarProfileContainer');

  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = profileDropdown.classList.contains('show');
      if (isOpen) {
        profileDropdown.classList.remove('show');
        profileBtn.classList.remove('active');
        profileBtn.setAttribute('aria-expanded', 'false');
      } else {
        profileDropdown.classList.add('show');
        profileBtn.classList.add('active');
        profileBtn.setAttribute('aria-expanded', 'true');
      }
    });

    document.addEventListener('click', (e) => {
      if (profileContainer && !profileContainer.contains(e.target)) {
        profileDropdown.classList.remove('show');
        profileBtn.classList.remove('active');
        profileBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        profileDropdown.classList.remove('show');
        profileBtn.classList.remove('active');
        profileBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const logoutBtn = document.getElementById('topbarLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logout();
      window.location.href = '/login';
    });
  }
  if (showTasks) {
    const tasksBtn = document.getElementById('topbarMyTasksBtn');
    if (tasksBtn) {
      tasksBtn.addEventListener('click', async () => {
        openMyTasksDrawer();
        const html = await renderMyTasksPanel();
        const body = document.getElementById('myTasksDrawerBody');
        if (body) body.innerHTML = html;
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
