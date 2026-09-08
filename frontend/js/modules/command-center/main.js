import '../fetch-instrumentation.js';
import { initThemeToggle } from '../theme.js';
import { initTopbarAuth } from '../topbar-auth.js';
import { ccState } from './state.js';
import { renderKpiStrip } from './kpi.js';
import { renderMatrix } from './matrix.js';
import { renderFeed } from './feed.js';
import { renderPlaybook } from './playbook.js';
import { renderTimeline } from './timeline.js';
import { initDrawer } from './drawer.js';
import { initAccountsNav } from './accounts-nav.js';
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

function init() {
  initThemeToggle();
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
  init();
});
