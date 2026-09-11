import '../fetch-instrumentation.js';
import { initThemeToggle } from '../theme.js';
import { initTopbarAuth } from '../topbar-auth.js';
import { showToast } from '../toast.js';
import { ccState } from './state.js';
import { renderKpiStrip } from './kpi.js';
import { renderMatrix } from './matrix.js';
import { renderFeed } from './feed.js';
import { renderPlaybook } from './playbook.js';
import { renderTimeline } from './timeline.js';
import { initDrawer } from './drawer.js';
import { initAccountsNav } from './accounts-nav.js';
import { renderDueSoon } from './due-soon.js';
import { renderHiringSignals } from './hiring-signals.js';
import { renderCapitalEvents, renderCoverageGaps, renderCompetitorMentions, renderTechSignals } from './account-signals.js';
import { kpiBase } from './data.js';

function weekRangeLabel() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now); monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Week of ${fmt(monday)} – ${fmt(sunday)}`;
}

function renderSubtitle() {
  const el = document.getElementById('ccSubtitle');
  if (el) el.textContent = `${weekRangeLabel()} · ${kpiBase.playsInMotion} open plays`;
}

async function renderKpi() {
  document.getElementById('ccKpiStrip').innerHTML = await renderKpiStrip(ccState.activeRole);
}

function renderAll() {
  renderKpi();
  renderFeed();
  renderPlaybook();
  renderTimeline();
  renderDueSoon();
  renderHiringSignals();
  renderCapitalEvents();
  renderCoverageGaps();
  renderCompetitorMentions();
  renderTechSignals();
}

function initRoleTabs() {
  const tabs = document.querySelectorAll('.cc-role-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      ccState.activeRole = tab.dataset.role;
      renderKpi();
    });
  });
}

function checkDashboardAccessNotice() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('no_dashboard_access') !== '1') return;
  showToast("You don't have Global Accounts Dashboard access yet — ask a super admin to grant you an account.");
  params.delete('no_dashboard_access');
  const rest = params.toString();
  history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
}

function init() {
  initThemeToggle();
  checkDashboardAccessNotice();
  renderSubtitle();
  initRoleTabs();
  initDrawer();
  initAccountsNav();
  renderAll();
  renderMatrix();
  window.addEventListener('resize', () => {
    if (ccState.matrixChart) ccState.matrixChart.resize();
  });
}

initTopbarAuth().then((user) => {
  if (!user) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return;
  }
  if (user.role !== 'super_admin' && user.has_command_center_access === false) {
    if (user.has_dashboard_access !== false) {
      window.location.href = '/?no_command_center_access=1';
      return;
    } else if (user.has_tasks_access !== false) {
      window.location.href = '/tasks?no_command_center_access=1';
      return;
    } else {
      // In-place restricted notice - DO NOT REDIRECT IN A LOOP!
      const container = document.querySelector('.cc-container') || document.body;
      container.innerHTML = `
        <div class="empty-block" style="margin:80px auto; max-width:460px; text-align:center; padding:40px; background:var(--card-bg); border-radius:12px; border:1px solid var(--border-color);">
          <div class="empty-block-icon" style="font-size:2.5rem; color:var(--text-muted); margin-bottom:16px;"><i class="bi bi-shield-lock"></i></div>
          <div style="font-size:1.15rem; font-weight:700; color:var(--text-primary); margin-bottom:8px;">Command Center Access Restricted</div>
          <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5;">You do not have access to the Sales Command Center. Please ask a Super Administrator to grant you permissions.</div>
        </div>`;
      return;
    }
  }
  init();
});
