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

  // 1. Root Node (CEO / Chairman & President) with intelligent authority scoring
  const candidateCEOs = [...allPersonas].map(p => {
    let score = 0;
    const title = (p.title || p.job_title || '').toLowerCase();
    const name = (p.name || p.full_name || '').trim();
    const isOfficeOf = /office of/i.test(title);

    // Authority ranking: Chairman & CEO > President & CEO > CEO > President
    if (/chairman\s*(?:and|&)\s*ceo/i.test(title) && !isOfficeOf) {
      score += 100;
    } else if (/^(?:group\s+)?chief executive officer/i.test(title) && !isOfficeOf) {
      score += 85;
    } else if (/president\s*(?:and|&)\s*ceo/i.test(title) && !isOfficeOf) {
      score += 90;
    } else if (/\bceo\b/i.test(title) && !/deputy|vice|assistant|associate|office of|coo|cfo|cio/i.test(title)) {
      score += 70;
    } else if (/\bpresident\b/i.test(title) && !/vice president|\bvp\b/i.test(title) && !isOfficeOf) {
      score += 40;
    }

    // Prefer full names over masked initials (e.g., "Larry Fink" over "Laurence F.")
    const parts = name.split(/\s+/);
    const hasInitialOnly = parts.length > 1 && parts[parts.length - 1].replace(/\./g, '').length === 1;
    if (hasInitialOnly) {
      score -= 35;
    } else {
      score += 20;
    }

    // Demote staff, assistants, deputies, and support roles
    if (/deputy|assistant|interim|office of|vice president|\bvp\b/i.test(title)) {
      score -= 60;
    }

    // Prefer verified profiles with LinkedIn
    if (p.linkedin_url) {
      score += 15;
    }

    return { persona: p, score };
  }).sort((a, b) => b.score - a.score);

  const bestCEO = candidateCEOs[0] && candidateCEOs[0].score > 0 ? candidateCEOs[0].persona : null;
  const rootName = tree.full_name || (bestCEO ? (bestCEO.name || bestCEO.full_name) : (allPersonas[0] || {}).name);
  const rootPersona = (bestCEO && bestCEO.name === rootName ? bestCEO : allPersonas.find(p => p.name === rootName)) || {
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
