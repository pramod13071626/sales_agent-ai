// Deals pipeline page (/deals). Board of Intro → Discovery → Proposal → Pilot → Contract
// with drag-and-drop, plus a deal room drawer (stage stepper, fields, health, exit
// checklist, buying committee, activity, tasks). API: apps/sales_deals/api.py.
import '../fetch-instrumentation.js';
import { initThemeToggle } from '../theme.js';
import { initTopbarAuth } from '../topbar-auth.js';
import { showToast } from '../toast.js';
import { esc } from '../utils.js';
import { downloadFile } from '../download.js';

const $ = (id) => document.getElementById(id);
const OPEN_STAGES = ['intro', 'discovery', 'proposal', 'pilot', 'contract'];
const ROLE_LABEL = { champion: 'Champion', economic_buyer: 'Economic buyer', technical_evaluator: 'Technical evaluator',
  influencer: 'Influencer', blocker: 'Blocker', user: 'User' };
const ACTIVITY_ICON = { note: 'fa-comment', stage: 'fa-diagram-next', checklist: 'fa-list-check', stakeholder: 'fa-user-plus',
  field: 'fa-pen', created: 'fa-flag' };

const st = { meta: null, deals: [], summary: {}, accounts: [], deal: null, tab: 'checklist', dragId: null };

async function api(path, opts = {}) {
  const res = await fetch(`/api/deals${path}`, {
    headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); throw new Error('unauthenticated'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`);
  return data;
}

// ── Formatting ───────────────────────────────────────────────────────────────
function money(v, cur = 'USD') {
  if (v == null) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, notation: v >= 100000 ? 'compact' : 'standard', maximumFractionDigits: v >= 100000 ? 1 : 0 }).format(v); }
  catch { return `${Math.round(v).toLocaleString()} ${cur}`; }
}
function dateLabel(d) { return d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; }
function isOverdue(d) { return d && new Date(`${String(d).slice(0, 10)}T23:59:59`) < new Date(); }
function initials(n) { return (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
function ago(ts) {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
function healthBadge(h) {
  if (!h || h.score == null) return '<span class="dl-health dl-health-closed">Closed</span>';
  return `<span class="dl-health dl-health-${h.level}" title="Deal health ${h.score}/100">${h.score}</span>`;
}

// ── Board ────────────────────────────────────────────────────────────────────
function card(d) {
  const overdue = isOverdue(d.next_step_due);
  const gap = (d.health && d.health.gaps && d.health.gaps[0]) || '';
  return `<article class="dl-card${d.stage === 'won' ? ' dl-won' : ''}${d.stage === 'lost' ? ' dl-lost' : ''}" draggable="${OPEN_STAGES.includes(d.stage)}"
      data-deal="${d.id}" tabindex="0" aria-label="${esc(d.name)}, ${esc(d.account_name)}">
    <div class="dl-card-top">
      <div><div class="dl-card-name">${esc(d.name)}</div><div class="dl-card-acct">${esc(d.account_name)}</div></div>
      ${healthBadge(d.health)}
    </div>
    <div class="dl-card-row">
      <span class="dl-value">${esc(money(d.value_amount, d.currency))}</span>
      ${d.expected_close ? `<span><i class="fa-regular fa-calendar"></i> ${esc(dateLabel(d.expected_close))}</span>` : ''}
      <span title="Buying committee"><i class="fa-solid fa-users"></i> ${d.stakeholder_count}</span>
      ${d.open_tasks ? `<span title="Open tasks"><i class="fa-solid fa-list-check"></i> ${d.open_tasks}</span>` : ''}
      ${d.stage_progress && d.stage_progress.total ? `<span title="Exit criteria done"><i class="fa-regular fa-square-check"></i> ${d.stage_progress.done}/${d.stage_progress.total}</span>` : ''}
    </div>
    ${d.next_step ? `<div class="dl-card-next ${overdue ? 'dl-overdue' : ''}"><i class="fa-solid fa-arrow-right"></i> ${esc(d.next_step)}${d.next_step_due ? ` · ${esc(dateLabel(d.next_step_due))}` : ''}</div>` : ''}
    ${gap && OPEN_STAGES.includes(d.stage) ? `<div class="dl-card-gap"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(gap)}</div>` : ''}
  </article>`;
}

function renderBoard() {
  const cols = (st.meta ? st.meta.stages : []).filter(s => OPEN_STAGES.includes(s.key));
  $('dlBoard').innerHTML = cols.map(s => {
    const ds = st.deals.filter(d => d.stage === s.key);
    const sum = st.summary[s.key] || { count: 0, value: 0 };
    return `<section class="dl-col" data-stage="${s.key}" aria-label="${esc(s.label)}">
      <div class="dl-col-head"><div class="dl-col-title">${esc(s.label)} <span class="dl-count">${sum.count}</span></div>
        <div class="dl-col-meta">${esc(money(sum.value))} pipeline</div></div>
      <div class="dl-col-body">${ds.map(card).join('') || '<div class="dl-empty-col">Drag a deal here</div>'}</div>
    </section>`;
  }).join('');
  const closed = st.deals.filter(d => ['won', 'lost'].includes(d.stage));
  const won = st.summary.won || { count: 0, value: 0 };
  const lost = st.summary.lost || { count: 0, value: 0 };
  $('dlClosed').innerHTML = closed.length ? `<details><summary>Closed — ${won.count} won (${esc(money(won.value))}) · ${lost.count} lost</summary>
      <div class="dl-closed-grid">${closed.map(card).join('')}</div></details>` : '';
  const open = st.deals.filter(d => OPEN_STAGES.includes(d.stage));
  const atRisk = open.filter(d => d.health && d.health.level === 'risk').length;
  $('dlSummary').textContent = open.length
    ? `${open.length} open deals · ${money(open.reduce((a, d) => a + (d.value_amount || 0), 0))} pipeline${atRisk ? ` · ${atRisk} at risk` : ''}`
    : 'No open deals yet — create one to start tracking the journey from intro to contract.';
}

async function loadDeals() {
  const params = new URLSearchParams();
  if ($('dlAccount').value) params.set('account_id', $('dlAccount').value);
  if ($('dlMine').checked) params.set('mine', 'true');
  if ($('dlSearch').value.trim()) params.set('q', $('dlSearch').value.trim());
  try {
    const data = await api(`?${params}`);
    st.deals = data.deals;
    st.summary = data.summary;
    renderBoard();
  } catch (err) { $('dlSummary').textContent = err.message; }
}

async function moveDeal(id, stage, extra = {}) {
  try {
    const d = await api(`/${id}`, { method: 'PATCH', body: { stage, ...extra } });
    (d.warnings || []).forEach(w => showToast(w));
    if (!d.warnings || !d.warnings.length) showToast(`Moved to ${d.stage_label}`);
    if (st.deal && st.deal.id === id) { st.deal = d; renderRoom(); }
    await loadDeals();
  } catch (err) { showToast(err.message); }
}

// ── Deal room ────────────────────────────────────────────────────────────────
function field(label, input, wide = false) { return `<label class="dl-field${wide ? ' dl-field-wide' : ''}">${label}${input}</label>`; }

function renderRoom() {
  const d = st.deal;
  if (!d) return;
  const idx = OPEN_STAGES.indexOf(d.stage);
  const h = d.health || {};
  const byStage = OPEN_STAGES.map(s => ({ s, items: d.checklist.filter(c => c.stage === s) }));
  const offerings = (st.meta.offerings || []).map(o => `<button type="button" class="dl-chip${d.offerings.includes(o.key) ? ' on' : ''}" data-offering="${o.key}" aria-pressed="${d.offerings.includes(o.key)}">${esc(o.label)}</button>`).join('');
  const committeeGaps = d.committee_gaps.map(g => ROLE_LABEL[g]).join(' and ');
  $('dlRoom').innerHTML = `
    <div class="dl-room-head">
      <div class="dl-room-head-row">
        <div><h2 class="dl-room-title" id="dlRoomTitle">${esc(d.name)}</h2>
          <div class="dl-room-acct"><a href="/?account=${d.account_id}">${esc(d.account_name)}</a>${d.owner && d.owner.name ? ` · owner ${esc(d.owner.name)}` : ''}</div></div>
        <button type="button" class="dl-icon" data-close-room aria-label="Close deal"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="dl-stepper" role="group" aria-label="Stage">${OPEN_STAGES.map((s, i) => {
        const lbl = st.meta.stages.find(x => x.key === s).label;
        return `<button type="button" class="dl-step${i < idx ? ' done' : ''}${s === d.stage ? ' current' : ''}" data-stage-step="${s}" aria-current="${s === d.stage ? 'step' : 'false'}">${esc(lbl)}</button>`;
      }).join('')}</div>
      ${OPEN_STAGES.includes(d.stage) ? `<div class="dl-close-btns">
          <button type="button" class="dl-btn" data-close-deal="won"><i class="fa-solid fa-trophy"></i> Mark won</button>
          <button type="button" class="dl-btn dl-btn-danger" data-close-deal="lost"><i class="fa-solid fa-circle-xmark"></i> Mark lost</button></div>`
        : `<div class="dl-warn">This deal is <strong>${esc(d.stage_label)}</strong>${d.lost_reason ? ` — ${esc(d.lost_reason)}` : ''}. <button type="button" class="dl-btn" data-stage-step="contract">Reopen</button></div>`}
    </div>
    <div class="dl-room-body">
      <div class="dl-grid">
        ${field('Value', `<input type="number" min="0" step="1000" data-field="value_amount" value="${d.value_amount ?? ''}">`)}
        ${field('Expected close', `<input type="date" data-field="expected_close" value="${d.expected_close ? String(d.expected_close).slice(0, 10) : ''}">`)}
        ${field('Next step', `<input data-field="next_step" maxlength="500" value="${esc(d.next_step || '')}" placeholder="What happens next?">`, true)}
        ${field('Next step due', `<input type="date" data-field="next_step_due" value="${d.next_step_due ? String(d.next_step_due).slice(0, 10) : ''}">`)}
        ${field('Deal name', `<input data-field="name" maxlength="200" value="${esc(d.name)}">`)}
        <div class="dl-field dl-field-wide">StradIT offerings<div class="dl-chips">${offerings}</div></div>
      </div>

      ${h.score != null ? `<div class="dl-section"><h3 class="dl-h3">Deal health</h3>
        <div class="dl-health-panel">
          <div class="dl-ring ${h.level}" style="--v:${h.score}"><span>${h.score}</span></div>
          <div class="dl-health-lists">
            ${h.gaps.length ? `<strong>Needs attention</strong><ul class="gap">${h.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
            ${h.reasons.length ? `<strong>Going well</strong><ul class="ok">${h.reasons.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
            <span class="cp-muted" style="font-size:.72rem;color:var(--text-muted)">${h.days_in_stage} days in ${esc(d.stage_label)}</span>
          </div>
        </div></div>` : ''}

      <div class="dl-tabs" role="tablist">${[['checklist', 'Exit criteria'], ['committee', `Buying committee (${d.stakeholders.length})`], ['activity', 'Activity'], ['tasks', `Tasks (${d.tasks.filter(t => !['done', 'cancelled'].includes(t.status)).length})`]]
        .map(([k, l]) => `<button type="button" class="dl-tab${st.tab === k ? ' active' : ''}" data-tab="${k}" role="tab" aria-selected="${st.tab === k}">${esc(l)}</button>`).join('')}</div>

      <div class="dl-pane${st.tab === 'checklist' ? ' active' : ''}" role="tabpanel">
        ${byStage.map(({ s, items }) => {
          const lbl = st.meta.stages.find(x => x.key === s).label;
          const done = items.filter(c => c.done).length;
          return `<details class="dl-check-stage${s === d.stage ? ' current' : ''}"${s === d.stage ? ' open' : ''}>
            <summary><span>${esc(lbl)}</span><span>${done}/${items.length}</span></summary>
            ${items.map(c => `<label class="dl-check-item${c.done ? ' done' : ''}"><input type="checkbox" data-check="${s}|${c.item_key}"${c.done ? ' checked' : ''}>
              <span>${esc(c.label)}</span>${c.note ? `<span class="dl-check-note">${esc(c.note)}</span>` : ''}</label>`).join('')}
          </details>`;
        }).join('')}
      </div>

      <div class="dl-pane${st.tab === 'committee' ? ' active' : ''}" role="tabpanel">
        ${committeeGaps ? `<div class="dl-gap-note"><i class="fa-solid fa-triangle-exclamation"></i> Missing: ${esc(committeeGaps)}</div>` : ''}
        ${d.stakeholders.map(p => `<div class="dl-person">
            <span class="dl-avatar">${esc(initials(p.name))}</span>
            <div><div class="dl-person-name"><a href="/profile?account=${p.account_id}&persona_id=${p.persona_id}" target="_blank" rel="noopener">${esc(p.name)}</a></div>
              <div class="dl-person-title">${esc(p.title || '')}</div>
              ${p.recent_move ? '<div class="dl-person-flag"><i class="fa-solid fa-user-clock"></i> Recent leadership change</div>' : ''}</div>
            <div class="dl-person-ctl">
              <select data-role="${p.persona_id}" aria-label="Role">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}"${k === p.role ? ' selected' : ''}>${l}</option>`).join('')}</select>
              <select data-sentiment="${p.persona_id}" aria-label="Sentiment"><option value="">—</option>${['positive', 'neutral', 'negative'].map(x => `<option${x === p.sentiment ? ' selected' : ''}>${x}</option>`).join('')}</select>
              <button type="button" class="dl-icon" data-remove-person="${p.persona_id}" aria-label="Remove ${esc(p.name)}"><i class="fa-regular fa-trash-can"></i></button>
            </div></div>`).join('') || '<p class="cp-muted" style="font-size:.8rem;color:var(--text-muted)">No one mapped yet. Start with the economic buyer and a champion.</p>'}
        <div class="dl-add-row">
          <input id="dlPersonSearch" placeholder="Add someone from ${esc(d.account_name)}…" aria-label="Search people to add" autocomplete="off">
          <select id="dlPersonRole" aria-label="Role for new person">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <div class="dl-suggest" id="dlPersonSuggest" hidden></div>
        </div>
      </div>

      <div class="dl-pane${st.tab === 'activity' ? ' active' : ''}" role="tabpanel">
        <form class="dl-note-form" id="dlNoteForm"><textarea id="dlNote" maxlength="2000" placeholder="Log a meeting note, decision or update…" aria-label="Note"></textarea>
          <button type="submit" class="dl-btn dl-btn-primary">Add</button></form>
        <ul class="dl-timeline">${d.activity.map(a => `<li><i class="fa-solid ${ACTIVITY_ICON[a.kind] || 'fa-circle'}"></i>
          <div>${esc(a.text)}<div class="dl-when">${esc(a.by || 'System')} · ${esc(ago(a.created_at))}</div></div></li>`).join('')}</ul>
      </div>

      <div class="dl-pane${st.tab === 'tasks' ? ' active' : ''}" role="tabpanel">
        <form class="dl-add-row" id="dlTaskForm" style="margin-top:0">
          <input id="dlTaskTitle" maxlength="500" placeholder="New task — e.g. Send the governance one-pager" aria-label="Task title" required>
          <input id="dlTaskDue" type="date" aria-label="Due date">
          <select id="dlTaskPriority" aria-label="Priority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select>
          <button type="submit" class="dl-btn dl-btn-primary">Add task</button>
        </form>
        ${d.tasks.map(t => `<div class="dl-task${['done', 'cancelled'].includes(t.status) ? ' done' : ''}">
          <span>${esc(t.title)}</span><span class="dl-pill">${esc(t.priority)}</span><span class="dl-pill">${esc(t.status.replace('_', ' '))}</span>
          ${t.due_date ? `<span class="${isOverdue(t.due_date) && !['done', 'cancelled'].includes(t.status) ? 'dl-overdue' : ''}" style="margin-left:auto;font-size:.72rem">${esc(dateLabel(t.due_date))}</span>` : ''}</div>`).join('')
          || '<p style="font-size:.8rem;color:var(--text-muted)">No tasks yet. Tasks added here also appear on <a href="/tasks">My Tasks</a>.</p>'}
      </div>
    </div>
    <div class="dl-room-foot">
      <a class="dl-btn" href="/copilot?account_id=${d.account_id}" title="Ask the Sales Copilot about this account"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask Copilot</a>
      <button type="button" class="dl-btn" data-export><i class="fa-regular fa-file-excel"></i> Export</button>
      <button type="button" class="dl-btn dl-btn-danger" data-delete style="margin-left:auto"><i class="fa-regular fa-trash-can"></i> Delete</button>
    </div>`;
}

async function openDeal(id) {
  try {
    st.deal = await api(`/${id}`);
    $('dlOverlay').hidden = false;
    $('dlRoom').hidden = false;
    renderRoom();
    const url = new URL(location.href); url.searchParams.set('deal', id); history.replaceState(null, '', url);
    $('dlRoom').querySelector('[data-close-room]').focus();
  } catch (err) { showToast(err.message); }
}

function closeRoom() {
  $('dlOverlay').hidden = true;
  $('dlRoom').hidden = true;
  st.deal = null;
  const url = new URL(location.href); url.searchParams.delete('deal'); history.replaceState(null, '', url);
}

async function patchDeal(body) {
  try {
    st.deal = await api(`/${st.deal.id}`, { method: 'PATCH', body });
    (st.deal.warnings || []).forEach(w => showToast(w));
    renderRoom();
    loadDeals();
  } catch (err) { showToast(err.message); }
}

let suggestTimer = null;
async function suggestPeople(q) {
  const box = $('dlPersonSuggest');
  try {
    const people = await api(`/${st.deal.id}/candidates?q=${encodeURIComponent(q)}`);
    box.innerHTML = people.map(p => `<button type="button" data-add-person="${p.id}">${esc(p.name)}
      <small>${esc(p.title || '')}${p.decision_authority ? ` · ${esc(p.decision_authority)}` : ''}</small></button>`).join('')
      || '<button type="button" disabled>No matches at this account</button>';
    box.hidden = false;
  } catch { box.hidden = true; }
}

function wireRoom() {
  const room = $('dlRoom');
  room.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-close-room]')) { closeRoom(); return; }
    const step = t.closest('[data-stage-step]');
    if (step && step.dataset.stageStep !== st.deal.stage) { patchDeal({ stage: step.dataset.stageStep }); return; }
    const close = t.closest('[data-close-deal]');
    if (close) {
      if (close.dataset.closeDeal === 'lost') {
        const reason = await askReason();
        if (reason) patchDeal({ stage: 'lost', lost_reason: reason });
      } else { patchDeal({ stage: 'won' }); }
      return;
    }
    const chip = t.closest('[data-offering]');
    if (chip) {
      const k = chip.dataset.offering;
      const next = st.deal.offerings.includes(k) ? st.deal.offerings.filter(x => x !== k) : [...st.deal.offerings, k];
      patchDeal({ offerings: next });
      return;
    }
    const tab = t.closest('[data-tab]');
    if (tab) { st.tab = tab.dataset.tab; renderRoom(); return; }
    const rm = t.closest('[data-remove-person]');
    if (rm) {
      try { st.deal = await api(`/${st.deal.id}/stakeholders/${rm.dataset.removePerson}`, { method: 'DELETE' }); renderRoom(); loadDeals(); }
      catch (err) { showToast(err.message); }
      return;
    }
    const add = t.closest('[data-add-person]');
    if (add) {
      try {
        st.deal = await api(`/${st.deal.id}/stakeholders`, { method: 'POST', body: { persona_id: Number(add.dataset.addPerson), role: $('dlPersonRole').value } });
        renderRoom(); loadDeals(); $('dlPersonSearch') && $('dlPersonSearch').focus();
      } catch (err) { showToast(err.message); }
      return;
    }
    if (t.closest('[data-export]')) { downloadFile(`/api/deals/${st.deal.id}/export`, 'deal.xlsx').catch(err => showToast(err.message)); return; }
    if (t.closest('[data-delete]')) {
      if (!await confirmInline('Delete this deal? Its tasks stay on My Tasks.')) return;
      try { await api(`/${st.deal.id}`, { method: 'DELETE' }); closeRoom(); loadDeals(); showToast('Deal deleted'); }
      catch (err) { showToast(err.message); }
    }
  });
  room.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.field) {
      const v = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : (t.value || null);
      if (t.dataset.field === 'name' && !v) { t.value = st.deal.name; return; }
      patchDeal({ [t.dataset.field]: v });
    } else if (t.dataset.check) {
      const [stage, key] = t.dataset.check.split('|');
      try { st.deal = await api(`/${st.deal.id}/checklist/${stage}/${key}`, { method: 'PATCH', body: { done: t.checked } }); renderRoom(); loadDeals(); }
      catch (err) { showToast(err.message); t.checked = !t.checked; }
    } else if (t.dataset.role || t.dataset.sentiment) {
      const pid = Number(t.dataset.role || t.dataset.sentiment);
      const p = st.deal.stakeholders.find(x => x.persona_id === pid);
      const body = { persona_id: pid, role: t.dataset.role ? t.value : p.role, sentiment: t.dataset.sentiment ? (t.value || null) : p.sentiment };
      try { st.deal = await api(`/${st.deal.id}/stakeholders`, { method: 'POST', body }); renderRoom(); loadDeals(); }
      catch (err) { showToast(err.message); }
    }
  });
  room.addEventListener('input', (e) => {
    if (e.target.id !== 'dlPersonSearch') return;
    clearTimeout(suggestTimer);
    const q = e.target.value.trim();
    suggestTimer = setTimeout(() => suggestPeople(q), 200);
  });
  room.addEventListener('focusin', (e) => { if (e.target.id === 'dlPersonSearch') suggestPeople(e.target.value.trim()); });
  room.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'dlNoteForm') {
      const text = $('dlNote').value.trim();
      if (!text) return;
      try { st.deal = await api(`/${st.deal.id}/notes`, { method: 'POST', body: { text } }); renderRoom(); loadDeals(); }
      catch (err) { showToast(err.message); }
    } else if (e.target.id === 'dlTaskForm') {
      const body = { title: $('dlTaskTitle').value.trim(), due_date: $('dlTaskDue').value || null, priority: $('dlTaskPriority').value };
      if (!body.title) return;
      try { st.deal = await api(`/${st.deal.id}/tasks`, { method: 'POST', body }); renderRoom(); loadDeals(); showToast('Task added — also on My Tasks'); }
      catch (err) { showToast(err.message); }
    }
  });
  document.addEventListener('click', (e) => {
    const box = $('dlPersonSuggest');
    if (box && !e.target.closest('.dl-add-row')) box.hidden = true;
  });
}

// Small inline prompts instead of window.prompt/confirm (keyboard- and screen-reader friendly)
function askReason() {
  return new Promise((resolve) => {
    const foot = $('dlRoom').querySelector('.dl-close-btns');
    foot.innerHTML = `<input id="dlLostReason" maxlength="500" placeholder="Why was it lost? (required)" style="flex:1" aria-label="Lost reason">
      <button type="button" class="dl-btn dl-btn-danger" id="dlLostGo">Mark lost</button><button type="button" class="dl-btn" id="dlLostCancel">Cancel</button>`;
    $('dlLostReason').focus();
    $('dlLostGo').onclick = () => { const v = $('dlLostReason').value.trim(); if (!v) { showToast('Please add a reason'); return; } resolve(v); };
    $('dlLostCancel').onclick = () => { renderRoom(); resolve(null); };
  });
}

function confirmInline(text) {
  return new Promise((resolve) => {
    const foot = $('dlRoom').querySelector('.dl-room-foot');
    const prev = foot.innerHTML;
    foot.innerHTML = `<span style="font-size:.82rem;align-self:center">${esc(text)}</span>
      <button type="button" class="dl-btn dl-btn-danger" id="dlYes" style="margin-left:auto">Delete</button><button type="button" class="dl-btn" id="dlNo">Cancel</button>`;
    $('dlNo').focus();
    $('dlYes').onclick = () => resolve(true);
    $('dlNo').onclick = () => { foot.innerHTML = prev; resolve(false); };
  });
}

// ── Drag & drop + keyboard ───────────────────────────────────────────────────
function wireBoard() {
  const board = $('dlBoard');
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('.dl-card');
    if (!c) return;
    st.dragId = Number(c.dataset.deal);
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', c.dataset.deal);
  });
  document.addEventListener('dragend', (e) => {
    const c = e.target.closest && e.target.closest('.dl-card');
    if (c) c.classList.remove('dragging');
    board.querySelectorAll('.drop-hover').forEach(x => x.classList.remove('drop-hover'));
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.dl-col');
    if (!col) return;
    e.preventDefault();
    board.querySelectorAll('.drop-hover').forEach(x => x !== col && x.classList.remove('drop-hover'));
    col.classList.add('drop-hover');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.dl-col');
    if (!col || !st.dragId) return;
    e.preventDefault();
    col.classList.remove('drop-hover');
    const d = st.deals.find(x => x.id === st.dragId);
    if (d && d.stage !== col.dataset.stage) moveDeal(d.id, col.dataset.stage);
    st.dragId = null;
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.dl-card');
    if (c) openDeal(Number(c.dataset.deal));
  });
  document.addEventListener('keydown', (e) => {
    const c = e.target.closest && e.target.closest('.dl-card');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDeal(Number(c.dataset.deal)); }
    // Alt+←/→ moves the focused card between stages (keyboard alternative to drag-and-drop)
    if (c && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const d = st.deals.find(x => x.id === Number(c.dataset.deal));
      const i = OPEN_STAGES.indexOf(d.stage) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i >= 0 && i < OPEN_STAGES.length) { e.preventDefault(); moveDeal(d.id, OPEN_STAGES[i]); }
    }
    if (e.key === 'Escape' && !$('dlRoom').hidden) closeRoom();
    if (e.key === 'Escape' && !$('dlModal').hidden) $('dlModal').hidden = true;
  });
  $('dlOverlay').addEventListener('click', closeRoom);
}

// ── New deal ─────────────────────────────────────────────────────────────────
async function ensureLookups() {
  if (!st.meta) st.meta = await api('/meta');
  if (!st.accounts.length) {
    const res = await fetch('/api/copilot/context');
    if (!res.ok) throw new Error(`Couldn't load accounts (${res.status})`);
    st.accounts = (await res.json()).accounts || [];
  }
}

async function openNewDeal() {
  try {
    await ensureLookups();
  } catch (err) { showToast(err.message); return; }
  if (!st.accounts.length) { showToast("You don't have access to any accounts yet — ask an admin to grant one."); return; }
  $('dlNewAccount').innerHTML = st.accounts.map(a => `<option value="${a.id}"${String(a.id) === $('dlAccount').value ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  $('dlNewOfferings').innerHTML = st.meta.offerings.map(o => `<button type="button" class="dl-chip" data-new-offering="${o.key}" aria-pressed="false">${esc(o.label)}</button>`).join('');
  $('dlNewStage').innerHTML = st.meta.stages.filter(s => OPEN_STAGES.includes(s.key)).map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
  $('dlNewForm').reset();
  $('dlModal').hidden = false;
  $('dlNewName').focus();
}

function wireNewDeal() {
  $('dlNew').addEventListener('click', openNewDeal);
  $('dlModal').addEventListener('click', (e) => {
    if (e.target === $('dlModal') || e.target.closest('[data-close-modal]')) $('dlModal').hidden = true;
    const chip = e.target.closest('[data-new-offering]');
    if (chip) { chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on')); }
  });
  $('dlNewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      account_id: Number($('dlNewAccount').value), name: $('dlNewName').value.trim(),
      value_amount: $('dlNewValue').value ? Number($('dlNewValue').value) : null, currency: $('dlNewCurrency').value,
      expected_close: $('dlNewClose').value || null, next_step: $('dlNewNext').value.trim() || null,
      next_step_due: $('dlNewNextDue').value || null, stage: $('dlNewStage').value,
      offerings: [...$('dlNewOfferings').querySelectorAll('.dl-chip.on')].map(c => c.dataset.newOffering),
    };
    try {
      const d = await api('', { method: 'POST', body });
      $('dlModal').hidden = true;
      showToast('Deal created — add the buying committee next');
      await loadDeals();
      st.tab = 'committee';
      openDeal(d.id);
    } catch (err) { showToast(err.message); }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    await ensureLookups();
    $('dlAccount').innerHTML = '<option value="">All accounts</option>' + st.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  } catch (err) { showToast(err.message); }
  const params = new URLSearchParams(location.search);
  if (params.get('account_id')) $('dlAccount').value = params.get('account_id');
  let t = null;
  $('dlSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadDeals, 250); });
  $('dlAccount').addEventListener('change', loadDeals);
  $('dlMine').addEventListener('change', loadDeals);
  wireBoard();
  wireRoom();
  wireNewDeal();
  await loadDeals();
  if (params.get('deal')) openDeal(Number(params.get('deal')));
  if (params.get('new') === '1') openNewDeal();
}

initThemeToggle();
initTopbarAuth().then((user) => {
  if (!user) { document.body.style.display = 'none'; location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
  init();
});
