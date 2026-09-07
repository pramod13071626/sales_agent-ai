// Entry point for the super-admin dashboard (/admin) — user management,
// per-user account access grants, and a small usage-stats/activity view.
// See AUTH_JWT_IMPLEMENTATION_PLAN.md. The backend independently enforces
// require_role("super_admin") on every /api/admin/* call regardless of what
// this page shows — the gate below is UX, not the actual security boundary.
import './fetch-instrumentation.js'; // must load first — patches window.fetch to attach the bearer token
import { getCurrentUser, logout, refreshAccessToken } from './auth-client.js';

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await logout();
  window.location.href = '/login';
});

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = (s == null ? '' : String(s));
  return d.innerHTML;
};

const main = document.getElementById('adminMain');
let usersCache = [];

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

function renderStats(stats) {
  return `
    <div class="panel">
      <div class="panel-title"><span><i class="bi bi-bar-chart-fill"></i> Usage Overview</span></div>
      <div class="metrics-grid">
        <div class="metric-tile"><div class="metric-value">${stats.total_users}</div><div class="metric-label">Total Users</div></div>
        <div class="metric-tile"><div class="metric-value">${stats.active_users}</div><div class="metric-label">Active Users</div></div>
        <div class="metric-tile"><div class="metric-value">${stats.super_admin_count}</div><div class="metric-label">Super Admins</div></div>
        <div class="metric-tile"><div class="metric-value">${stats.total_accounts}</div><div class="metric-label">Total Accounts</div></div>
      </div>
    </div>
  `;
}

function renderCreateForm() {
  return `
    <div class="panel">
      <div class="panel-title"><span><i class="bi bi-person-plus-fill"></i> Create User</span></div>
      <form class="admin-create-form" id="createUserForm">
        <div><label>Full Name</label><input type="text" name="full_name" placeholder="Jane Doe"></div>
        <div><label>Email</label><input type="email" name="email" required placeholder="jane@company.com"></div>
        <div><label>Password</label><input type="password" name="password" required minlength="8" placeholder="Min 8 characters"></div>
        <div><label>Role</label>
          <select name="role">
            <option value="user" selected>user</option>
            <option value="super_admin">super_admin</option>
          </select>
        </div>
        <div><button type="submit" class="admin-create-submit" id="createUserSubmit">Create</button></div>
        <div class="admin-form-error" id="createUserError" hidden></div>
      </form>
    </div>
  `;
}

function renderUsersTable(users, currentUserId) {
  const rows = users.map(u => `
    <tr data-user-id="${u.id}">
      <td>
        <div class="admin-user-name">${esc(u.full_name || '—')}</div>
        <div class="admin-user-email">${esc(u.email)}</div>
      </td>
      <td>
        <select class="admin-role-select" data-action="role" ${u.id === currentUserId ? 'disabled title="You cannot change your own role"' : ''}>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
          <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>super_admin</option>
        </select>
      </td>
      <td><span class="pill ${u.is_active ? 'pill-success' : 'pill-muted'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>${timeAgo(u.last_login_at)}</td>
      <td class="admin-row-actions">
        <button type="button" class="admin-icon-btn" data-action="access"><i class="bi bi-diagram-3"></i> Access</button>
        <button type="button" class="admin-icon-btn" data-action="toggle-active" ${u.id === currentUserId ? 'disabled title="You cannot deactivate yourself"' : ''}>
          <i class="bi bi-power"></i> ${u.is_active ? 'Deactivate' : 'Activate'}
        </button>
        <button type="button" class="admin-icon-btn danger" data-action="delete" ${u.id === currentUserId ? 'disabled title="You cannot delete yourself"' : ''}>
          <i class="bi bi-trash"></i> Delete
        </button>
      </td>
    </tr>
  `).join('');

  return `
    <div class="panel">
      <div class="panel-title"><span><i class="bi bi-people-fill"></i> Users</span><span class="context-badge live">${users.length}</span></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">No users yet.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderActivity(stats) {
  const items = (stats.recent_audit || []).map(e => `
    <div class="admin-activity-row">
      <i class="bi bi-dot admin-activity-icon"></i>
      <div>
        <div class="admin-activity-text"><strong>${esc(e.actor)}</strong> — ${esc(e.action.replace(/_/g, ' '))}${e.target ? ` — <strong>${esc(e.target)}</strong>` : ''}</div>
        <div class="admin-activity-time">${timeAgo(e.created_at)}</div>
      </div>
    </div>
  `).join('');
  return `
    <div class="panel">
      <div class="panel-title"><span><i class="bi bi-clock-history"></i> Recent Activity</span></div>
      <div class="admin-activity-list">${items || '<div class="empty-block-text">No activity recorded yet.</div>'}</div>
    </div>
  `;
}

function renderModalShell() {
  return `
    <div class="admin-modal-backdrop" id="accessModalBackdrop">
      <div class="admin-modal">
        <div class="admin-modal-header">
          <div class="admin-modal-title" id="accessModalTitle">Manage Access</div>
          <button type="button" class="admin-modal-close" id="accessModalClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="admin-modal-body" id="accessModalBody"></div>
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
  const stats = await statsRes.json();
  const usersData = await usersRes.json();
  usersCache = usersData.users || [];

  const me = getCurrentUser();
  main.innerHTML = `
    ${renderStats(stats)}
    ${renderCreateForm()}
    ${renderUsersTable(usersCache, me ? me.id : null)}
    ${renderActivity(stats)}
    ${renderModalShell()}
  `;
  wireEvents();
}

function wireEvents() {
  document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorEl = document.getElementById('createUserError');
    const submitBtn = document.getElementById('createUserSubmit');
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      const body = {
        full_name: form.full_name.value.trim() || null,
        email: form.email.value.trim(),
        password: form.password.value,
        role: form.role.value,
      };
      const res = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not create user');
      form.reset();
      await loadAndRender();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  main.querySelector('.admin-table').addEventListener('change', async (e) => {
    const select = e.target.closest('[data-action="role"]');
    if (!select) return;
    const userId = select.closest('tr').dataset.userId;
    await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: select.value }),
    });
    await loadAndRender();
  });

  main.querySelector('.admin-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const userId = parseInt(btn.closest('tr').dataset.userId, 10);
    const user = usersCache.find(u => u.id === userId);

    if (btn.dataset.action === 'toggle-active') {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      await loadAndRender();
    } else if (btn.dataset.action === 'delete') {
      if (!window.confirm(`Delete ${user.email}? This cannot be undone.`)) return;
      await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      await loadAndRender();
    } else if (btn.dataset.action === 'access') {
      openAccessModal(userId, user.email);
    }
  });

  document.getElementById('accessModalClose').addEventListener('click', closeAccessModal);
  document.getElementById('accessModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'accessModalBackdrop') closeAccessModal();
  });
}

function closeAccessModal() {
  document.getElementById('accessModalBackdrop').classList.remove('open');
}

async function openAccessModal(userId, email) {
  const backdrop = document.getElementById('accessModalBackdrop');
  const body = document.getElementById('accessModalBody');
  document.getElementById('accessModalTitle').textContent = `Account Access — ${email}`;
  body.innerHTML = '<div class="admin-page-loading" style="margin:20px auto;"><div class="admin-page-spinner"></div> Loading…</div>';
  backdrop.classList.add('open');

  const res = await fetch(`/api/admin/users/${userId}/accounts`);
  const data = await res.json();
  if (data.role === 'super_admin') {
    body.innerHTML = '<div class="empty-block-text">This user is a super_admin — they already have access to every account and do not need explicit grants.</div>';
    return;
  }

  body.innerHTML = (data.accounts || []).map(a => `
    <div class="admin-access-row">
      <label class="admin-access-toggle">
        <input type="checkbox" data-account-id="${a.id}" ${a.granted ? 'checked' : ''}>
        ${esc(a.name)}
      </label>
    </div>
  `).join('') || '<div class="empty-block-text">No accounts exist yet.</div>';

  body.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const accountId = cb.dataset.accountId;
      const method = cb.checked ? 'POST' : 'DELETE';
      cb.disabled = true;
      try {
        await fetch(`/api/admin/users/${userId}/accounts/${accountId}`, { method });
      } finally {
        cb.disabled = false;
      }
    });
  });
}

async function init() {
  await refreshAccessToken();
  const user = getCurrentUser();
  if (!user) {
    main.innerHTML = `<div class="admin-page-error">You need to sign in to view this page. <a href="/login?next=/admin">Sign in</a></div>`;
    return;
  }
  if (user.role !== 'super_admin') {
    main.innerHTML = `<div class="admin-page-error">This page is only available to super admins. <a href="/">Back to dashboard</a></div>`;
    return;
  }
  try {
    await loadAndRender();
  } catch (err) {
    main.innerHTML = `<div class="admin-page-error">Could not load the admin dashboard — ${esc(err.message)}</div>`;
  }
}

init();
