// Small topbar widget: "Sign In" link when logged out, or the user's email
// + an Admin link (super_admin only) + a "My Tasks" cross-account action-item
// count + Logout when logged in. Not enforced anywhere yet (AUTH_ENFORCED=false
// server-side, see AUTH_JWT_IMPLEMENTATION_PLAN.md §9) — this just makes the
// feature discoverable and usable while that's the case.
import { esc, initials } from './utils.js';
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

function formatUserRole(role) {
  if (!role) return 'Standard User';
  const r = String(role).toLowerCase().replace(/_/g, ' ');
  if (r === 'super admin') return 'Super Administrator';
  if (r === 'ae' || r === 'sales rep') return 'Account Executive';
  if (r === 'leader' || r === 'sales leader') return 'Sales Leader';
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function render() {
  const el = document.getElementById('topbarAuthWidget');
  if (!el) return;
  const user = getCurrentUser();

  if (!user) {
    el.innerHTML = `<a href="/login" class="topbar-link"><i class="fa-solid fa-right-to-bracket"></i> Sign In</a>`;
    return;
  }

  const showTasks = user.role === 'super_admin' || user.has_tasks_access !== false;
  const displayName = user.full_name || user.email || 'User';
  const userInitials = initials(displayName);
  const roleName = formatUserRole(user.role);

  el.innerHTML = `
    <div class="topbar-user-menu-wrapper">
      ${showTasks ? '<button type="button" id="topbarMyTasksBtn" class="topbar-link topbar-link-btn" title="My Action Items"><i class="fa-solid fa-list-check"></i> My Tasks <span class="tab-badge" id="topbarMyTasksBadge">…</span></button>' : ''}
      
      <div class="topbar-dropdown-container">
        <button type="button" id="topbarUserDropdownBtn" class="topbar-user-btn" aria-expanded="false" aria-haspopup="true" title="User profile & options">
          <span class="topbar-auth-avatar">${esc(userInitials)}</span>
          <span class="topbar-user-name">${esc(displayName)}</span>
          <i class="fa-solid fa-chevron-down topbar-user-chevron"></i>
        </button>

        <div class="topbar-user-dropdown" id="topbarUserDropdown" role="menu" aria-hidden="true">
          <div class="topbar-user-dropdown-header">
            <div class="topbar-dropdown-avatar">${esc(userInitials)}</div>
            <div class="topbar-dropdown-info">
              <div class="topbar-dropdown-name">${esc(displayName)}</div>
              <div class="topbar-dropdown-email" title="${esc(user.email)}">${esc(user.email)}</div>
            </div>
          </div>

          <div class="topbar-dropdown-role-box">
            <span class="topbar-role-label">User Role</span>
            <span class="topbar-role-badge"><i class="fa-solid fa-user-shield"></i> ${esc(roleName)}</span>
          </div>

          <div class="topbar-dropdown-divider"></div>

          <div class="topbar-dropdown-actions">
            ${user.role === 'super_admin' ? '<a href="/admin" class="topbar-dropdown-item"><i class="fa-solid fa-users-gear"></i> Admin Management</a>' : ''}
            <button type="button" id="topbarDropdownLogoutBtn" class="topbar-dropdown-item topbar-dropdown-logout">
              <i class="fa-solid fa-right-from-bracket"></i> Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const dropdownBtn = document.getElementById('topbarUserDropdownBtn');
  const dropdownMenu = document.getElementById('topbarUserDropdown');
  const logoutBtn = document.getElementById('topbarDropdownLogoutBtn');

  if (dropdownBtn && dropdownMenu) {
    const toggleMenu = (e) => {
      e.stopPropagation();
      const isOpen = dropdownMenu.classList.contains('open');
      if (isOpen) {
        dropdownMenu.classList.remove('open');
        dropdownBtn.classList.remove('open');
        dropdownBtn.setAttribute('aria-expanded', 'false');
      } else {
        dropdownMenu.classList.add('open');
        dropdownBtn.classList.add('open');
        dropdownBtn.setAttribute('aria-expanded', 'true');
      }
    };

    dropdownBtn.addEventListener('click', toggleMenu);

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdownMenu.contains(e.target) && !dropdownBtn.contains(e.target)) {
        dropdownMenu.classList.remove('open');
        dropdownBtn.classList.remove('open');
        dropdownBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdownMenu.classList.contains('open')) {
        dropdownMenu.classList.remove('open');
        dropdownBtn.classList.remove('open');
        dropdownBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logout();
      window.location.replace('/login');
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

// Ensure pages restored via browser Back/Forward (bfcache) revalidate session
window.addEventListener('pageshow', async (event) => {
  if (event.persisted) {
    const user = await refreshAccessToken();
    if (!user) {
      document.body.style.display = 'none';
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    } else {
      render();
    }
  }
});

export async function initTopbarAuth() {
  await refreshAccessToken(); // silent — restores a session from the refresh cookie on page load
  render();
  return getCurrentUser();
}
