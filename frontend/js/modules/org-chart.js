import { state } from './state.js';
import { dashContent, signalModalBody, signalModalBackdrop } from './dom.js';
import { esc, initials, dedupePersonas } from './utils.js';
import { showToast } from './toast.js';
import { openContactDrawer } from './contact-drawer.js';

export function renderOrgChart(account, lob) {
  if (lob) {
    // Function expression (not a declaration) so it stays scoped to this
    // `if` block without tripping no-inner-declarations — a second,
    // differently-defaulted nodeCard exists further down in the
    // corporate-level branch of this same function, so a hoisted
    // declaration here would collide with it.
    const nodeCard = (node, isRoot) => {
      const name = node.full_name || node.name || 'Executive';
      const title = node.job_title || node.title || (isRoot ? 'Operating Head' : 'Stakeholder');
      const tags = [node.seniority_tier || node.tier, node.decision_authority ? `Decision: ${node.decision_authority}` : null].filter(Boolean);
      return `
        <button type="button" class="orgchart-node ${isRoot ? 'orgchart-root-node' : ''}" data-persona-name="${esc(name)}">
          <div class="orgchart-avatar">${esc(initials(name))}</div>
          <div class="orgchart-name">${esc(name)}</div>
          <div class="orgchart-title">${esc(title)}</div>
          ${tags.length ? `<div class="orgchart-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </button>`;
    };
    const lobPersonas = dedupePersonas(lob.personas || []);
    const headName = lob.head || lob.operating_head;

    let rootNode = null;
    let reports = [];

    if (headName) {
      rootNode = lobPersonas.find(p => p.name === headName || p.full_name === headName) || {
        full_name: headName,
        job_title: 'Operating Head',
        seniority_tier: 'Division Head',
        decision_authority: 'primary'
      };
      reports = lobPersonas.filter(p => (p.name || p.full_name) !== headName);
    } else if (lobPersonas.length) {
      const sorted = [...lobPersonas].sort((a, b) => {
        const aTier = (a.tier || '').toLowerCase().includes('c') ? 0 : ((a.tier || '').toLowerCase().includes('vp') ? 1 : 2);
        const bTier = (b.tier || '').toLowerCase().includes('c') ? 0 : ((b.tier || '').toLowerCase().includes('vp') ? 1 : 2);
        if (aTier !== bTier) return aTier - bTier;
        return (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99);
      });
      rootNode = sorted[0];
      reports = sorted.slice(1);
    }

    if (!rootNode) {
      return `<div class="empty-block">
        <div class="empty-block-icon"><i class="bi bi-diagram-2"></i></div>
        <div class="empty-block-text">No verified reporting-line tree captured yet for <strong>${esc(lob.name)}</strong>.</div>
      </div>`;
    }

    return `
      <div class="orgchart">
        <div class="orgchart-root">${nodeCard(rootNode, true)}</div>
        ${reports.length ? `
          <div class="orgchart-connector"></div>
          <div class="orgchart-reports">${reports.map(r => nodeCard(r, false)).join('')}</div>
        ` : ''}
      </div>
    `;
  }

  // Corporate level (no LOB selected) — render full multi-tier enterprise tree
  const allPersonas = dedupePersonas(account.personas || []);
  const tree = account.organisational_hierarchy_tree || {};

  // 1. Root Node (CEO / President)
  const rootName = tree.full_name || (allPersonas.find(p => /chief executive|ceo|president/i.test(p.title || '')) || allPersonas[0] || {}).name;
  const rootPersona = allPersonas.find(p => p.name === rootName) || {
    full_name: rootName || 'Chief Executive Officer',
    job_title: tree.job_title || 'President & Chief Executive Officer',
    seniority_tier: 'C-Suite',
    decision_authority: 'final'
  };

  // 2. Level 2: C-Suite & Board Level Direct Reports
  const cSuiteReports = [];
  const directNames = new Set((tree.direct_reports || []).map(r => r.full_name));

  allPersonas.forEach(p => {
    if (p.name === rootName) return;
    const isC = (p.tier || '').toLowerCase().includes('c') || /director of board|board member|chairman|vice chair|lead consultant/i.test(p.title || '') || directNames.has(p.name);
    if (isC) {
      cSuiteReports.push(p);
    }
  });

  // 3. Level 3: All remaining VPs grouped by Functional Domain
  const renderedNames = new Set([rootName, ...cSuiteReports.map(p => p.name)]);
  const remainingVPs = allPersonas.filter(p => !renderedNames.has(p.name));

  const clusters = [
    {
      id: 'directors',
      title: 'Vice Presidents & Directors',
      icon: 'bi-award',
      filter: p => /director/i.test(p.title || '')
    },
    {
      id: 'dept_app',
      title: 'Department & Application Leadership',
      icon: 'bi-grid-1x2',
      filter: p => /department head|application|tax manager|team lead/i.test(p.title || '')
    },
    {
      id: 'scrum_proj',
      title: 'Engineering, Project & Scrum Leads',
      icon: 'bi-cpu',
      filter: p => /scrum|project lead|consultant/i.test(p.title || '')
    },
    {
      id: 'ops_lead',
      title: 'Operations & Enterprise Lead Managers',
      icon: 'bi-briefcase',
      filter: () => true // Catch-all for remaining VPs
    }
  ];

  const vpGroups = [];
  const assignedVpNames = new Set();

  clusters.forEach(c => {
    const matched = remainingVPs.filter(p => !assignedVpNames.has(p.name) && c.filter(p));
    matched.forEach(p => assignedVpNames.add(p.name));
    if (matched.length) {
      vpGroups.push({ ...c, people: matched });
    }
  });

  function nodeCard(node, isRoot) {
    const name = node.full_name || node.name || 'Executive';
    const title = node.job_title || node.title || (isRoot ? 'President & CEO' : 'Executive');
    const tags = [node.seniority_tier || node.tier, node.decision_authority ? `Decision: ${node.decision_authority}` : null].filter(Boolean);
    return `
      <button type="button" class="orgchart-node ${isRoot ? 'orgchart-root-node' : ''}" data-persona-name="${esc(name)}">
        <div class="orgchart-avatar">${esc(initials(name))}</div>
        <div class="orgchart-name">${esc(name)}</div>
        <div class="orgchart-title">${esc(title)}</div>
        ${tags.length ? `<div class="orgchart-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </button>`;
  }

  return `
    <div class="orgchart">
      <!-- Level 1: Group Chief Executive -->
      <div class="orgchart-root">${nodeCard(rootPersona, true)}</div>

      ${cSuiteReports.length ? `
        <div class="orgchart-connector"></div>
        <!-- Level 2: C-Suite & Executive Board -->
        <div class="orgchart-reports">${cSuiteReports.map(r => nodeCard(r, false)).join('')}</div>
      ` : ''}

      ${vpGroups.length ? `
        <div class="orgchart-connector" style="height:20px;"></div>
        <!-- Level 3: Functional VP & Divisional Branches -->
        ${vpGroups.map(g => `
          <div class="orgchart-tier-block">
            <div class="orgchart-tier-header">
              <span class="orgchart-tier-title"><i class="bi ${g.icon}"></i> ${esc(g.title)}</span>
              <span class="orgchart-tier-count">${g.people.length} mapped</span>
            </div>
            <div class="orgchart-tier-grid">
              ${g.people.map(p => nodeCard(p, false)).join('')}
            </div>
          </div>
        `).join('')}
      ` : ''}
    </div>
  `;
}

function handleOrgChartClick(e) {
  const btn = e.target.closest('.orgchart-node');
  if (!btn) return;
  const account = state.accounts.find(a => a.id === state.activeAccountId);
  if (!account) return;
  const persona = dedupePersonas(account.personas || []).find(p => p.name === btn.dataset.personaName);
  if (persona) {
    signalModalBackdrop.classList.remove('open');
    openContactDrawer(persona);
  } else {
    showToast(`${btn.dataset.personaName} isn't in the mapped contacts list yet.`);
  }
}
dashContent.addEventListener('click', handleOrgChartClick);
signalModalBody.addEventListener('click', handleOrgChartClick);
