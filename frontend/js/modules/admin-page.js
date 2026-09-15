// Entry point for the super-admin dashboard (/admin) — Command Center.
import './fetch-instrumentation.js';
import { getCurrentUser, logout, refreshAccessToken } from './auth-client.js';
import { initThemeToggle } from './theme.js';
import { showToast } from './toast.js';

initThemeToggle();

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await logout();
  window.location.href = '/login';
});

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

const main = document.getElementById('adminMain');
let usersCache = [];
let statsCache = null;
let currentFilter = 'all';
let searchQuery = '';

let auditLogs = [];
let auditOffset = 0;
const AUDIT_PAGE_SIZE = 5;
let auditTotal = 0;
let auditHasMore = false;
let auditLoading = false;

function timeAgo(iso) {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getInitials(name, email) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return (email || 'U').slice(0, 2).toUpperCase();
}

function renderTopBarUser(user) {
  const el = document.getElementById('topbarAuthUser');
  if (!el || !user) return;
  const displayName = user.full_name || user.email;
  el.innerHTML = `
    <i class="bi bi-person-circle" style="font-size:1.05rem; opacity:0.9;"></i>
    <span style="font-weight:600; color:#fff;" title="${esc(user.email)}">${esc(displayName)}</span>
    <span style="background:rgba(255,255,255,0.18); color:#fff; font-size:0.64rem; font-weight:700; padding:2px 7px; border-radius:4px; letter-spacing:0.04em; text-transform:uppercase;">Super Admin</span>
  `;
}

function renderHero() {
  return `
    <div class="admin-hero">
      <div>
        <h1 class="admin-hero-title">Platform Administration & Governance</h1>
        <p class="admin-hero-sub">Manage user accounts, assign corporate sales access permissions, and audit real-time platform security.</p>
      </div>
    </div>
  `;
}

function renderKPIBanner(stats) {
  return `
    <div class="admin-kpi-grid">
      <div class="admin-kpi-card">
        <div class="admin-kpi-icon blue"><i class="bi bi-people-fill"></i></div>
        <div>
          <div class="admin-kpi-value">${stats.total_users || 0}</div>
          <div class="admin-kpi-label">Total Users</div>
        </div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-icon green"><i class="bi bi-person-check-fill"></i></div>
        <div>
          <div class="admin-kpi-value">${stats.active_users || 0}</div>
          <div class="admin-kpi-label">Active Users</div>
        </div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-icon purple"><i class="bi bi-shield-shaded"></i></div>
        <div>
          <div class="admin-kpi-value">${stats.super_admin_count || 0}</div>
          <div class="admin-kpi-label">Super Admins</div>
        </div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-icon amber"><i class="bi bi-buildings"></i></div>
        <div>
          <div class="admin-kpi-value">${stats.total_accounts || 0}</div>
          <div class="admin-kpi-label">Tracked Accounts</div>
        </div>
      </div>
    </div>
  `;
}

function renderCreateForm() {
  return `
    <div class="admin-panel admin-create-panel">
      <div class="admin-panel-header">
        <div class="admin-panel-title"><i class="bi bi-person-plus-fill"></i> Create New User Account</div>
        <span class="context-badge live"><i class="bi bi-shield-plus"></i> Instant Provisioning</span>
      </div>
      <div class="admin-panel-body">
        <form id="createUserForm" class="admin-form-horizontal">
          <div class="admin-form-group">
            <label>Full Name</label>
            <input type="text" name="full_name" placeholder="e.g. Jane Doe" autocomplete="off">
          </div>
          <div class="admin-form-group">
            <label>Work Email Address</label>
            <input type="email" name="email" required placeholder="name@company.com" autocomplete="off">
          </div>
          <div class="admin-form-group">
            <label>Initial Password</label>
            <input type="password" name="password" required minlength="8" placeholder="Min 8 characters" autocomplete="new-password">
          </div>
          <div class="admin-form-group">
            <label>Assigned Role</label>
            <select name="role">
              <option value="user" selected>Standard User</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <div class="admin-form-group btn-group">
            <button type="submit" class="admin-submit-btn" id="createUserSubmit">
              <i class="bi bi-plus-circle-fill"></i> Create User
            </button>
          </div>
        </form>
        <div class="admin-form-error" id="createUserError" style="display:none; margin-top:12px;"></div>
      </div>
    </div>
  `;
}

function getFilteredUsers() {
  let list = usersCache;
  if (currentFilter === 'active') list = list.filter(u => u.is_active);
  else if (currentFilter === 'inactive') list = list.filter(u => !u.is_active);
  else if (currentFilter === 'super_admin') list = list.filter(u => u.role === 'super_admin');
  else if (currentFilter === 'user') list = list.filter(u => u.role === 'user');

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(u =>
      (u.full_name && u.full_name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q))
    );
  }
  return list;
}

function renderUsersTable(currentUserId) {
  const filtered = getFilteredUsers();
  const rows = filtered.map(u => {
    const initials = getInitials(u.full_name, u.email);
    const isAdmin = u.role === 'super_admin';
    const isSelf = u.id === currentUserId;

    return `
      <tr data-user-id="${u.id}">
        <td>
          <div class="admin-user-cell">
            <div class="admin-avatar ${isAdmin ? 'admin-role' : ''}">${initials}</div>
            <div>
              <div class="admin-user-name">${esc(u.full_name || '—')}${isSelf ? ' <span style="font-size:0.68rem; color:var(--brand); font-weight:700;">(You)</span>' : ''}</div>
              <div class="admin-user-email">${esc(u.email)}</div>
            </div>
          </div>
        </td>
        <td>
          <select class="admin-role-select" data-action="role" ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
            <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
          </select>
        </td>
        <td>
          <span class="admin-status-pill ${u.is_active ? 'active' : 'inactive'}">
            <span class="dot"></span> ${u.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td style="color:var(--text-muted); font-size:0.75rem;">
          ${timeAgo(u.last_login_at)}
        </td>
        <td>
          <div class="admin-row-actions">
            <button type="button" class="admin-btn admin-access-btn" data-action="access" title="Manage account visibility">
              <i class="bi bi-shield-lock"></i> Access
            </button>
            <div class="admin-kebab-wrap">
              <button type="button" class="admin-btn admin-kebab-btn" data-action="kebab-toggle" title="More options" aria-haspopup="true">
                <i class="bi bi-three-dots-vertical"></i>
              </button>
              <div class="admin-kebab-menu d-none">
                <button type="button" class="admin-kebab-item" data-action="edit-user">
                  <i class="bi bi-pencil-square"></i> Edit User
                </button>
                ${!isAdmin ? `
                  <button type="button" class="admin-kebab-item" data-action="toggle-active">
                    <i class="bi bi-power"></i> ${u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <div class="admin-kebab-divider"></div>
                  <button type="button" class="admin-kebab-item danger" data-action="delete">
                    <i class="bi bi-trash-fill"></i> Delete User
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="admin-panel">
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <i class="bi bi-people-fill"></i> User Directory & Access Control
        </div>
        <span class="context-badge live" id="userCountBadge">${filtered.length} of ${usersCache.length} users</span>
      </div>

      <div class="admin-filter-bar">
        <div class="admin-search-box">
          <i class="bi bi-search search-icon"></i>
          <input type="text" class="admin-search-input" id="adminUserSearch" placeholder="Search by name, email, or role..." value="${esc(searchQuery)}">
          <button type="button" class="admin-search-clear" id="adminUserSearchClear"><i class="bi bi-x-circle-fill"></i></button>
        </div>
        <div class="admin-filter-chips">
          <button type="button" class="admin-filter-chip ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
          <button type="button" class="admin-filter-chip ${currentFilter === 'active' ? 'active' : ''}" data-filter="active">Active</button>
          <button type="button" class="admin-filter-chip ${currentFilter === 'inactive' ? 'active' : ''}" data-filter="inactive">Inactive</button>
          <button type="button" class="admin-filter-chip ${currentFilter === 'super_admin' ? 'active' : ''}" data-filter="super_admin">Super Admins</button>
          <button type="button" class="admin-filter-chip ${currentFilter === 'user' ? 'active' : ''}" data-filter="user">Users</button>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="adminTableBody">
            ${rows || `<tr><td colspan="5" style="text-align:center; padding:36px; color:var(--text-muted);"><i class="bi bi-search" style="font-size:1.5rem; display:block; margin-bottom:8px;"></i> No users matched your search criteria.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAuditRow(e) {
  return `
    <div class="admin-activity-row">
      <div class="admin-activity-icon-wrap"><i class="bi bi-shield-check"></i></div>
      <div class="admin-activity-content">
        <div class="admin-activity-text">
          <strong>${esc(e.actor)}</strong> — ${esc((e.action || '').replace(/_/g, ' '))}
          ${e.target ? ` on <strong>${esc(e.target)}</strong>` : ''}
        </div>
        <div class="admin-activity-time">${timeAgo(e.created_at)}</div>
      </div>
    </div>
  `;
}

function renderActivity() {
  return `
    <div class="admin-panel">
      <div class="admin-panel-header">
        <div class="admin-panel-title"><i class="bi bi-clock-history"></i> Security & Audit Trail</div>
        <span class="context-badge live" id="auditCountBadge">Loading…</span>
      </div>
      <div class="admin-panel-body">
        <div class="admin-activity-list" id="adminActivityList">
          <div class="admin-audit-loading"><div class="spinner-sm"></div> Loading audit records…</div>
        </div>
        <div class="admin-audit-footer" id="adminAuditFooter" style="display:none;">
          <button type="button" class="admin-btn" id="loadMoreAuditBtn">
            <i class="bi bi-arrow-down-circle"></i> Load More Logs (<span id="auditRemainingCount">0</span> remaining)
          </button>
        </div>
      </div>
    </div>
  `;
}

async function loadAuditLogs(reset = false) {
  if (auditLoading) return;
  if (reset) {
    auditOffset = 0;
    auditLogs = [];
  }
  auditLoading = true;
  const footer = document.getElementById('adminAuditFooter');
  const loadBtn = document.getElementById('loadMoreAuditBtn');
  const listEl = document.getElementById('adminActivityList');
  const badge = document.getElementById('auditCountBadge');

  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.innerHTML = '<div class="spinner-sm"></div> Loading…';
  }

  try {
    const res = await fetch(`/api/admin/audit-logs?limit=${AUDIT_PAGE_SIZE}&offset=${auditOffset}`);
    if (res.ok) {
      const data = await res.json();
      const newLogs = data.audit_logs || [];
      auditLogs = reset ? newLogs : [...auditLogs, ...newLogs];
      auditTotal = data.total || 0;
      auditHasMore = data.has_more;
      auditOffset += newLogs.length;

      if (badge) badge.textContent = `${auditLogs.length} of ${auditTotal}`;

      if (!auditLogs.length) {
        if (listEl) listEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:16px;">No activity logged yet.</div>';
        if (footer) footer.style.display = 'none';
      } else {
        if (listEl) listEl.innerHTML = auditLogs.map(renderAuditRow).join('');
        if (footer) {
          if (auditHasMore) {
            footer.style.display = 'block';
            footer.innerHTML = `
              <button type="button" class="admin-btn" id="loadMoreAuditBtn">
                <i class="bi bi-arrow-down-circle"></i> Load More Logs (<span id="auditRemainingCount">${auditTotal - auditLogs.length}</span> remaining)
              </button>
            `;
            const newBtn = document.getElementById('loadMoreAuditBtn');
            if (newBtn) {
              newBtn.addEventListener('click', () => loadAuditLogs(false));
            }
          } else {
            footer.style.display = 'block';
            footer.innerHTML = '<div style="font-size:0.72rem; color:var(--text-muted); text-align:center; padding:4px 0;"><i class="bi bi-check2-all"></i> All audit records loaded</div>';
          }
        }
      }
    } else {
      throw new Error(`Server returned ${res.status}`);
    }
  } catch (err) {
    console.error('Failed to load audit logs', err);
    if (listEl && !auditLogs.length) {
      listEl.innerHTML = `<div class="admin-form-error">Could not load audit logs — ${esc(err.message)}</div>`;
    }
  } finally {
    auditLoading = false;
  }
}

function renderModalShell() {
  return `
    <div class="admin-modal-backdrop" id="accessModalBackdrop">
      <div class="admin-modal">
        <div class="admin-modal-header">
          <div class="admin-modal-title" id="accessModalTitle">Manage Account &amp; Dashboard Access</div>
          <button type="button" class="admin-modal-close" id="accessModalClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div id="accessModalDashboardToggles"></div>
        <div class="admin-access-section-label" id="accessModalDashboardLabel" style="display:none;">
          <i class="bi bi-buildings"></i> Assigned Company Accounts &amp; Dossiers
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); padding:0 24px 8px 24px; margin-top:-4px; display:none;" id="accessModalAccountSubLabel">
          Assign individual company accounts (e.g. BNY Mellon, BlackRock) to grant access to company intelligence, org charts, hiring trends, and financials.
        </div>
        <div class="admin-modal-toolbar" id="accessModalToolbar">
          <input type="text" class="admin-modal-search" id="accessModalSearch" placeholder="Filter company accounts (e.g. BNY, BlackRock)...">
        </div>
        <div class="admin-modal-body" id="accessModalBody"></div>
      </div>
    </div>

    <div class="admin-modal-backdrop" id="editUserModalBackdrop">
      <div class="admin-modal" style="max-width: 480px;">
        <div class="admin-modal-header">
          <div class="admin-modal-title" id="editUserModalTitle">
            <i class="bi bi-person-gear"></i> Edit User Account
          </div>
          <button type="button" class="admin-modal-close" id="editUserModalClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <form class="admin-modal-form" id="editUserForm">
          <input type="hidden" name="user_id" id="editUserId">
          <div class="admin-modal-body" style="padding:20px; display:flex; flex-direction:column; gap:14px;">
            <div class="admin-form-group">
              <label class="admin-form-label" for="editUserFullName"><i class="bi bi-person"></i> Full Name</label>
              <input type="text" class="admin-form-input" id="editUserFullName" name="full_name" placeholder="e.g. Robin Vince">
            </div>
            <div class="admin-form-group">
              <label class="admin-form-label" for="editUserEmail"><i class="bi bi-envelope"></i> Email Address <span style="font-weight:400; font-size:0.7rem; color:var(--text-muted); margin-left:4px;">(Read-only)</span></label>
              <input type="email" class="admin-form-input" id="editUserEmail" name="email" readonly disabled style="opacity:0.75; cursor:not-allowed; background:var(--input-bg);" placeholder="user@company.com" title="Email address cannot be modified">
            </div>
            <div class="admin-form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="admin-form-group">
                <label class="admin-form-label" for="editUserRole"><i class="bi bi-shield-check"></i> System Role</label>
                <select class="admin-form-select" id="editUserRole" name="role">
                  <option value="user">User</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div class="admin-form-group">
                <label class="admin-form-label" for="editUserStatus"><i class="bi bi-activity"></i> Account Status</label>
                <select class="admin-form-select" id="editUserStatus" name="is_active">
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
            <div class="admin-form-group">
              <label class="admin-form-label" for="editUserPassword">
                <i class="bi bi-key"></i> New Password <span style="font-weight:400; font-size:0.7rem; color:var(--text-muted);">(Leave blank to keep unchanged)</span>
              </label>
              <input type="password" class="admin-form-input" id="editUserPassword" name="password" placeholder="••••••••" autocomplete="new-password">
            </div>
            <div class="admin-form-error" id="editUserError" style="display:none;"></div>
          </div>
          <div class="admin-modal-footer" style="display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid var(--panel-border); background:var(--panel-bg);">
            <button type="button" class="admin-btn" id="editUserCancelBtn">Cancel</button>
            <button type="submit" class="admin-btn primary" id="editUserSubmitBtn">
              <i class="bi bi-check2-circle"></i> Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

async function loadAndRender() {
  const [statsRes, usersRes] = await Promise.all([
    fetch('/api/admin/stats'),
    fetch('/api/admin/users'),
  ]);
  if (!statsRes.ok || !usersRes.ok) throw new Error('Failed to load admin data');
  statsCache = await statsRes.json();
  const usersData = await usersRes.json();
  usersCache = usersData.users || [];

  const me = getCurrentUser();
  if (me) {
    renderTopBarUser(me);
  }

  main.innerHTML = `
    ${renderHero()}
    ${renderKPIBanner(statsCache)}
    ${renderCreateForm()}
    <div class="admin-grid">
      <div class="admin-col-main">
        ${renderUsersTable(me ? me.id : null)}
      </div>
      <div class="admin-col-side">
        ${renderActivity()}
      </div>
    </div>
    ${renderModalShell()}
  `;
  wireEvents();
  loadAuditLogs(true);
}

function wireEvents() {
  const me = getCurrentUser();
  const currentUserId = me ? me.id : null;

  // Search input
  const searchInput = document.getElementById('adminUserSearch');
  const searchClear = document.getElementById('adminUserSearchClear');
  if (searchInput) {
    if (searchQuery) searchClear.style.display = 'block';
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      searchClear.style.display = searchQuery ? 'block' : 'none';
      updateTableOnly(currentUserId);
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchQuery = '';
      searchInput.value = '';
      searchClear.style.display = 'none';
      updateTableOnly(currentUserId);
    });
  }

  // Filter chips
  main.querySelectorAll('.admin-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      main.querySelectorAll('.admin-filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      updateTableOnly(currentUserId);
    });
  });

  // Create User Form
  const form = document.getElementById('createUserForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('createUserError');
      const submitBtn = document.getElementById('createUserSubmit');
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<div class="spinner-sm"></div> Creating Account…';
      try {
        const body = {
          full_name: form.full_name.value.trim() || null,
          email: form.email.value.trim(),
          password: form.password.value,
          role: form.role.value,
        };
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not create user');
        form.reset();
        showToast(`User ${data.email} created successfully`);
        await loadAndRender();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'flex';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-plus-circle-fill"></i> Create User Account';
      }
    });
  }

  // User Actions (Role, Toggle Active, Delete, Access)
  const table = main.querySelector('.admin-table');
  if (table) {
    table.addEventListener('change', async (e) => {
      const select = e.target.closest('[data-action="role"]');
      if (!select) return;
      const userId = select.closest('tr').dataset.userId;
      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: select.value }),
        });
        if (!res.ok) throw new Error('Failed to update role');
        showToast('User role updated');
        await loadAndRender();
      } catch (err) {
        alert(err.message);
      }
    });

    // Kebab menu toggle & item click delegation
    table.addEventListener('click', async (e) => {
      const kebabBtn = e.target.closest('[data-action="kebab-toggle"]');
      if (kebabBtn) {
        e.stopPropagation();
        const wrap = kebabBtn.closest('.admin-kebab-wrap');
        const menu = wrap.querySelector('.admin-kebab-menu');
        const isHidden = menu.classList.contains('d-none');
        // Close all other open kebab menus and remove open class
        document.querySelectorAll('.admin-kebab-menu').forEach(m => m.classList.add('d-none'));
        document.querySelectorAll('.admin-kebab-wrap').forEach(w => w.classList.remove('open'));
        if (isHidden) {
          wrap.classList.add('open');
          const rect = kebabBtn.getBoundingClientRect();
          if (window.innerHeight - rect.bottom < 170) {
            menu.classList.add('dropup');
          } else {
            menu.classList.remove('dropup');
          }
          menu.classList.remove('d-none');
        }
        return;
      }

      const actionItem = e.target.closest('button[data-action]');
      if (!actionItem || actionItem.disabled) return;
      const tr = actionItem.closest('tr');
      if (!tr) return;
      const userId = parseInt(tr.dataset.userId, 10);
      const user = usersCache.find(u => u.id === userId);
      if (!user) return;
      const isSelf = currentUserId === userId;

      // Close open kebab menu on action
      document.querySelectorAll('.admin-kebab-menu').forEach(m => m.classList.add('d-none'));
      document.querySelectorAll('.admin-kebab-wrap').forEach(w => w.classList.remove('open'));

      if (actionItem.dataset.action === 'edit-user') {
        openEditUserModal(user, isSelf);
      } else if (actionItem.dataset.action === 'toggle-active') {
        if (isSelf && user.is_active) {
          showToast('You cannot deactivate your own logged-in account.');
          return;
        }
        try {
          const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !user.is_active }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || 'Failed to update user status');
          }
          showToast(`User ${user.email} is now ${!user.is_active ? 'Active' : 'Inactive'}`);
          await loadAndRender();
        } catch (err) {
          alert(err.message);
        }
      } else if (actionItem.dataset.action === 'delete') {
        if (isSelf) {
          showToast('You cannot delete your own logged-in account.');
          return;
        }
        if (!window.confirm(`Are you sure you want to permanently delete user "${user.email}"? This action cannot be undone.`)) return;
        try {
          const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || 'Failed to delete user');
          }
          showToast(`User ${user.email} deleted`);
          await loadAndRender();
        } catch (err) {
          alert(err.message);
        }
      } else if (actionItem.dataset.action === 'access') {
        openAccessModal(userId, user.email);
      }
    });
  }

  // Close open kebab menus on document click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.admin-kebab-wrap')) {
      document.querySelectorAll('.admin-kebab-menu').forEach(m => m.classList.add('d-none'));
      document.querySelectorAll('.admin-kebab-wrap').forEach(w => w.classList.remove('open'));
    }
  });

  // Edit User Form submission
  const editForm = document.getElementById('editUserForm');
  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('editUserId').value;
      const errorEl = document.getElementById('editUserError');
      const submitBtn = document.getElementById('editUserSubmitBtn');

      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<div class="spinner-sm"></div> Saving…';

      try {
        const payload = {
          full_name: editForm.full_name.value.trim() || null,
          role: editForm.role.value,
          is_active: editForm.is_active.value === 'true',
        };
        const passVal = editForm.password.value;
        if (passVal) {
          payload.password = passVal;
        }

        const res = await fetch(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to update user profile');

        closeEditUserModal();
        showToast(`User ${data.email} updated successfully`);
        await loadAndRender();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'flex';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-check2-circle"></i> Save Changes';
      }
    });
  }

  // Edit Modal close handlers
  const editCloseBtn = document.getElementById('editUserModalClose');
  if (editCloseBtn) editCloseBtn.addEventListener('click', closeEditUserModal);

  const editCancelBtn = document.getElementById('editUserCancelBtn');
  if (editCancelBtn) editCancelBtn.addEventListener('click', closeEditUserModal);

  const editBackdrop = document.getElementById('editUserModalBackdrop');
  if (editBackdrop) {
    editBackdrop.addEventListener('click', (e) => {
      if (e.target.id === 'editUserModalBackdrop') closeEditUserModal();
    });
  }

  // Access Modal close handlers
  document.getElementById('accessModalClose').addEventListener('click', closeAccessModal);
  document.getElementById('accessModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'accessModalBackdrop') closeAccessModal();
  });
}

function closeEditUserModal() {
  const backdrop = document.getElementById('editUserModalBackdrop');
  if (backdrop) backdrop.classList.remove('open');
}

function openEditUserModal(user, isSelf) {
  const backdrop = document.getElementById('editUserModalBackdrop');
  const title = document.getElementById('editUserModalTitle');
  const idInput = document.getElementById('editUserId');
  const nameInput = document.getElementById('editUserFullName');
  const emailInput = document.getElementById('editUserEmail');
  const roleSelect = document.getElementById('editUserRole');
  const statusSelect = document.getElementById('editUserStatus');
  const passInput = document.getElementById('editUserPassword');
  const errorEl = document.getElementById('editUserError');

  if (!backdrop || !user) return;

  if (title) title.innerHTML = `<i class="bi bi-person-gear"></i> Edit User — ${esc(user.email)}`;
  if (idInput) idInput.value = user.id;
  if (nameInput) nameInput.value = user.full_name || '';
  if (emailInput) emailInput.value = user.email || '';
  if (roleSelect) {
    roleSelect.value = user.role || 'user';
    roleSelect.disabled = isSelf;
    roleSelect.title = isSelf ? 'You cannot change your own role' : '';
  }
  if (statusSelect) {
    statusSelect.value = user.is_active ? 'true' : 'false';
    statusSelect.disabled = isSelf;
    statusSelect.title = isSelf ? 'You cannot deactivate your own account' : '';
  }
  if (passInput) passInput.value = '';
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }

  backdrop.classList.add('open');
}

function updateTableOnly(currentUserId) {
  const filtered = getFilteredUsers();
  const countBadge = document.getElementById('userCountBadge');
  if (countBadge) countBadge.textContent = `${filtered.length} of ${usersCache.length} users`;

  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;

  const rows = filtered.map(u => {
    const initials = getInitials(u.full_name, u.email);
    const isAdmin = u.role === 'super_admin';
    const isSelf = u.id === currentUserId;

    return `
      <tr data-user-id="${u.id}">
        <td>
          <div class="admin-user-cell">
            <div class="admin-avatar ${isAdmin ? 'admin-role' : ''}">${initials}</div>
            <div>
              <div class="admin-user-name">${esc(u.full_name || '—')}${isSelf ? ' <span style="font-size:0.68rem; color:var(--brand); font-weight:700;">(You)</span>' : ''}</div>
              <div class="admin-user-email">${esc(u.email)}</div>
            </div>
          </div>
        </td>
        <td>
          <select class="admin-role-select" data-action="role" ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
            <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
          </select>
        </td>
        <td>
          <span class="admin-status-pill ${u.is_active ? 'active' : 'inactive'}">
            <span class="dot"></span> ${u.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td style="color:var(--text-muted); font-size:0.75rem;">
          ${timeAgo(u.last_login_at)}
        </td>
        <td>
          <div class="admin-row-actions">
            <button type="button" class="admin-btn admin-access-btn" data-action="access" title="Manage account visibility">
              <i class="bi bi-shield-lock"></i> Access
            </button>
            <div class="admin-kebab-wrap">
              <button type="button" class="admin-btn admin-kebab-btn" data-action="kebab-toggle" title="More options" aria-haspopup="true">
                <i class="bi bi-three-dots-vertical"></i>
              </button>
              <div class="admin-kebab-menu d-none">
                <button type="button" class="admin-kebab-item" data-action="edit-user">
                  <i class="bi bi-pencil-square"></i> Edit User
                </button>
                ${!isAdmin ? `
                  <button type="button" class="admin-kebab-item" data-action="toggle-active">
                    <i class="bi bi-power"></i> ${u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <div class="admin-kebab-divider"></div>
                  <button type="button" class="admin-kebab-item danger" data-action="delete">
                    <i class="bi bi-trash-fill"></i> Delete User
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rows || `<tr><td colspan="5" style="text-align:center; padding:36px; color:var(--text-muted);"><i class="bi bi-search" style="font-size:1.5rem; display:block; margin-bottom:8px;"></i> No users matched your search criteria.</td></tr>`;
}

function closeAccessModal() {
  document.getElementById('accessModalBackdrop').classList.remove('open');
}

function renderDashboardAccessToggles(userId, permissions, disabled) {
  const wrap = document.getElementById('accessModalDashboardToggles');
  if (!wrap) return;

  const dashboards = [
    {
      key: 'has_dashboard_access',
      name: 'Global Executive Digest & Radar',
      icon: 'bi-bar-chart-line-fill',
      path: '/',
      sub: 'Cross-account portfolio overview, executive briefing & macro sales alerts',
    },
    {
      key: 'has_command_center_access',
      name: 'Sales Command Center',
      icon: 'bi-graph-up-arrow',
      path: '/command-center',
      sub: 'Action-first rep & manager daily command dashboard',
    },
    {
      key: 'has_tasks_access',
      name: 'My Tasks & Action Items',
      icon: 'bi-list-check',
      path: '/tasks',
      sub: 'Personal task manager, reminders & cross-account deliverables',
    },
    {
      key: 'has_pipeline_access',
      name: 'Data Pipeline Console',
      icon: 'bi-compass',
      path: '/pipeline',
      sub: 'Raw data ingestion pipeline & automated scraper runs',
    },
  ];

  wrap.innerHTML = `
    <div class="admin-access-section-label">
      <i class="bi bi-grid-1x2"></i> Dashboard &amp; View Permissions
    </div>
    <div class="admin-access-dashboards-grid">
      ${dashboards.map(d => {
        const hasAccess = !!permissions[d.key];
        return `
          <div class="admin-access-row">
            <label class="admin-access-toggle">
              <input type="checkbox" data-perm-key="${d.key}" ${hasAccess ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
              <div>
                <div><i class="bi ${d.icon}" style="margin-right:4px; color:var(--brand);"></i> <strong>${esc(d.name)}</strong> <span style="font-size:0.7rem; color:var(--text-muted);">(${d.path})</span></div>
                <div style="font-size:0.72rem; color:var(--text-muted); font-weight:normal;">${esc(d.sub)}</div>
              </div>
            </label>
            <span style="font-size:0.7rem; color:var(--text-muted); white-space:nowrap; margin-left:8px;">
              ${disabled ? 'Always on for Super Admin' : (hasAccess ? '<i class="bi bi-check-circle-fill" style="color:var(--success);"></i> Granted' : '<i class="bi bi-slash-circle" style="color:var(--danger);"></i> Restricted')}
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (disabled) return;

  wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const permKey = cb.dataset.permKey;
      cb.disabled = true;
      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [permKey]: cb.checked }),
        });
        if (!res.ok) throw new Error('Request failed');
        permissions[permKey] = cb.checked;
        showToast(`Updated dashboard permission`);
        renderDashboardAccessToggles(userId, permissions, false);
      } catch (err) {
        showToast('Failed to update dashboard access permission.');
        cb.checked = !cb.checked;
        cb.disabled = false;
      }
    });
  });
}

async function openAccessModal(userId, email) {
  const backdrop = document.getElementById('accessModalBackdrop');
  const body = document.getElementById('accessModalBody');
  const searchInput = document.getElementById('accessModalSearch');
  const toolbar = document.getElementById('accessModalToolbar');
  const dashboardLabel = document.getElementById('accessModalDashboardLabel');
  const accountSubLabel = document.getElementById('accessModalAccountSubLabel');
  const togglesWrap = document.getElementById('accessModalDashboardToggles');

  document.getElementById('accessModalTitle').textContent = `Account & Dashboard Access — ${email}`;
  if (togglesWrap) togglesWrap.innerHTML = '';
  if (dashboardLabel) dashboardLabel.style.display = 'none';
  if (accountSubLabel) accountSubLabel.style.display = 'none';
  body.innerHTML = '<div class="admin-page-loading" style="margin:20px auto;"><div class="spinner-sm"></div> Loading permissions &amp; accounts…</div>';
  backdrop.classList.add('open');

  try {
    const res = await fetch(`/api/admin/users/${userId}/accounts`);
    const data = await res.json();
    if (data.role === 'super_admin') {
      toolbar.style.display = 'none';
      renderDashboardAccessToggles(userId, {
        has_dashboard_access: true,
        has_command_center_access: true,
        has_tasks_access: true,
        has_pipeline_access: true,
      }, true);
      body.innerHTML = `
        <div style="padding:24px; text-align:center; color:var(--text-secondary);">
          <i class="bi bi-shield-lock" style="font-size:2rem; color:var(--brand); display:block; margin-bottom:12px;"></i>
          <strong>Super Admin Global Access</strong>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;">
            This user is a Super Admin and automatically holds unrestricted access to all dashboards and accounts.
          </p>
        </div>
      `;
      return;
    }

    renderDashboardAccessToggles(userId, {
      has_dashboard_access: data.has_dashboard_access !== false,
      has_command_center_access: data.has_command_center_access !== false,
      has_tasks_access: data.has_tasks_access !== false,
      has_pipeline_access: data.has_pipeline_access !== false,
    }, false);

    if (dashboardLabel) dashboardLabel.style.display = 'flex';
    if (accountSubLabel) accountSubLabel.style.display = 'block';
    toolbar.style.display = 'flex';
    searchInput.value = '';

    const allAccounts = data.accounts || [];

    const renderAccountList = (filterText = '') => {
      const filtered = allAccounts.filter(a => (a.name || '').toLowerCase().includes(filterText.toLowerCase()));
      body.innerHTML = filtered.map(a => `
        <div class="admin-access-row">
          <label class="admin-access-toggle">
            <input type="checkbox" data-account-id="${a.id}" ${a.granted ? 'checked' : ''}>
            <span>${esc(a.name)}</span>
          </label>
          <span style="font-size:0.7rem; color:var(--text-muted);">${a.granted ? '<i class="bi bi-check-circle-fill" style="color:var(--success);"></i> Granted' : 'Restricted'}</span>
        </div>
      `).join('') || '<div style="color:var(--text-muted); text-align:center; padding:16px;">No matching accounts found.</div>';

      body.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', async () => {
          const accountId = cb.dataset.accountId;
          const method = cb.checked ? 'POST' : 'DELETE';
          cb.disabled = true;
          try {
            await fetch(`/api/admin/users/${userId}/accounts/${accountId}`, { method });
            const acc = allAccounts.find(x => x.id === parseInt(accountId, 10));
            if (acc) acc.granted = cb.checked;
            showToast(`Access ${cb.checked ? 'granted' : 'revoked'}`);
          } catch (err) {
            showToast('Failed to update access grant.');
          } finally {
            cb.disabled = false;
          }
        });
      });
    };

    renderAccountList('');

    searchInput.addEventListener('input', (e) => {
      renderAccountList(e.target.value.trim());
    });
  } catch (err) {
    body.innerHTML = `<div class="admin-form-error">Could not load accounts — ${esc(err.message)}</div>`;
  }
}

// ── Topbar Organization Accounts Dropdown ──────────────────────
let topbarAccountsCache = null;

async function loadTopbarAccounts() {
  if (topbarAccountsCache) return topbarAccountsCache;
  try {
    const res = await fetch('/api/accounts');
    if (res.ok) {
      const data = await res.json();
      topbarAccountsCache = data.accounts || [];
    } else {
      topbarAccountsCache = [];
    }
  } catch (err) {
    console.error('Failed to load accounts for topbar dropdown', err);
    topbarAccountsCache = [];
  }
  return topbarAccountsCache;
}

function renderTopbarAccountsList(accounts) {
  const listEl = document.getElementById('dropdownAccountList');
  const countEl = document.getElementById('dropdownAccountCount');
  if (!listEl) return;

  if (countEl) countEl.textContent = accounts.length;

  if (!accounts.length) {
    listEl.innerHTML = '<div class="dropdown-empty">No organisation accounts found.</div>';
    return;
  }

  listEl.innerHTML = accounts.map(a => {
    const ticker = a.ticker || a.stock_symbol || '';
    const score = a.heat_score != null ? `${a.heat_score} SCORE` : '';
    const name = a.name || a.display_name || a.legal_name || 'Account';
    const initStr = getInitials(name, '');
    const industry = (a.industries || [])[0] || a.company_type || 'Enterprise';
    const contacts = a.total_contacts_captured || (a.personas || []).length || 0;

    return `
      <div class="dropdown-account-item" data-account-id="${a.id}" style="cursor:pointer;" onclick="window.location.href='/?account=${a.id}'">
        <div class="dropdown-account-avatar">${esc(initStr)}</div>
        <div class="dropdown-account-info">
          <div class="dropdown-account-name">${esc(name)}</div>
          <div class="dropdown-account-sub">
            ${ticker ? `<span style="font-weight:600; color:var(--brand);">${esc(ticker)}</span> · ` : ''}
            <span>${esc(industry)}</span>
            ${contacts ? `<span>· ${contacts} contacts</span>` : ''}
          </div>
        </div>
        ${score ? `<span class="dropdown-account-badge">${esc(score)}</span>` : ''}
      </div>
    `;
  }).join('');
}

function initTopbarAccountsDropdown() {
  const container = document.getElementById('topbarAccountsDropdown');
  const btn = document.getElementById('globalAccountsBtn');
  const menu = document.getElementById('globalAccountsMenu');
  if (!container || !btn || !menu) return;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpening = menu.classList.contains('d-none');
    
    if (isOpening) {
      container.classList.add('active');
      menu.classList.remove('d-none');
      
      const accounts = await loadTopbarAccounts();
      renderTopbarAccountsList(accounts);
    } else {
      container.classList.remove('active');
      menu.classList.add('d-none');
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      container.classList.remove('active');
      menu.classList.add('d-none');
    }
  });

  // Close when ESC is pressed
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('d-none')) {
      container.classList.remove('active');
      menu.classList.add('d-none');
    }
  });
}

initTopbarAccountsDropdown();

async function init() {
  await refreshAccessToken();
  const user = getCurrentUser();
  if (!user) {
    window.location.href = '/login?next=/admin';
    return;
  }
  if (user.role !== 'super_admin') {
    main.innerHTML = `
      <div class="admin-page-error">
        <i class="bi bi-shield-slash" style="font-size:2.5rem; color:var(--danger); display:block; margin-bottom:12px;"></i>
        <h2>Access Restricted</h2>
        <p>This console is restricted to Super Administrators only.</p>
        <button type="button" class="admin-btn" id="restrictedLogoutBtn" style="margin-top:16px;"><i class="bi bi-box-arrow-right"></i> Sign Out</button>
      </div>
    `;
    const rBtn = document.getElementById('restrictedLogoutBtn');
    if (rBtn) {
      rBtn.addEventListener('click', async () => {
        await logout();
        window.location.href = '/login';
      });
    }
    return;
  }
  renderTopBarUser(user);
  try {
    await loadAndRender();
  } catch (err) {
    main.innerHTML = `<div class="admin-page-error">Could not load the admin dashboard — ${esc(err.message)}</div>`;
  }
}

init();
