// Introductions page (/introductions): warm-intro board (proposed → … → converted),
// intro drawer (triage, fields, convert to deal, timeline + notes), attribution report and
// connector management. API: apps/sales_crm/introductions.py. No AI requests.
import '../fetch-instrumentation.js';
import { initThemeToggle } from '../theme.js';
import { initTopbarAuth } from '../topbar-auth.js';
import { showToast } from '../toast.js';
import { esc } from '../utils.js';
import { downloadFile } from '../download.js';
import { mountTimeline } from '../activity-timeline.js';

const $ = (id) => document.getElementById(id);
const BOARD = ['proposed', 'requested', 'accepted', 'intro_made', 'meeting_held', 'converted'];
const OPEN = BOARD.slice(0, 5);
const KIND_LABEL = { partner: 'Partner', advisor: 'Advisor', employee: 'Employee', customer: 'Customer', other: 'Other' };
const EVENT_ICON = { status: 'fa-arrow-right', note: 'fa-comment', field: 'fa-pen', created: 'fa-flag', converted: 'fa-trophy' };

const st = {
  meta: null, intros: [], summary: {}, labels: {}, connectors: [], accounts: [], view: 'board',
  intro: null, dragId: null, partnerUsers: [], defaultPct: 50,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
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
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', notation: v >= 100000 ? 'compact' : 'standard', maximumFractionDigits: v >= 100000 ? 1 : 0 }).format(v); }
  catch { return `${Math.round(v).toLocaleString()} ${cur}`; }
}
function ago(ts) {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
const contactOf = (i) => i.persona_name || i.submitted.contact_name || 'Contact not chosen';
const accountOf = (i) => i.account_name || i.submitted.account_name || '—';
const readOnly = () => !!(st.meta && st.meta.me && st.meta.me.read_only && st.meta.auth_enforced);

// ── Board ────────────────────────────────────────────────────────────────────
function card(i) {
  const stale = OPEN.includes(i.status) && i.days_in_status >= 21;
  return `<article class="dl-card in-card" draggable="${OPEN.includes(i.status) && !readOnly()}" data-intro="${i.id}" tabindex="0"
      aria-label="${esc(contactOf(i))}, ${esc(accountOf(i))}, via ${esc(i.connector.name)}">
    <div class="dl-card-name">${esc(contactOf(i))}</div>
    <div class="dl-card-acct">${esc(accountOf(i))}${i.needs_triage ? ' <span class="in-pill warn">Needs triage</span>' : ''}</div>
    <div class="dl-card-row">
      <span class="in-pill"><i class="fa-solid fa-handshake"></i> ${esc(i.connector.name)}</span>
      ${i.business_line_name ? `<span>${esc(i.business_line_name)}</span>` : ''}
    </div>
    ${i.deal ? `<div class="dl-card-row"><span class="dl-value">${esc(money(i.deal.value_amount, i.deal.currency))}</span>
      <span>${esc(i.deal.stage)}</span>${i.attribution_pct != null ? `<span title="Attribution">${i.attribution_pct}%</span>` : ''}</div>` : ''}
    ${i.next_step ? `<div class="dl-card-next"><i class="fa-solid fa-arrow-right"></i> ${esc(i.next_step)}</div>` : ''}
    <div class="dl-card-row in-card-foot${stale ? ' in-stale' : ''}"><span>${i.owner_name ? esc(i.owner_name) : 'Unassigned'}</span>
      <span>${i.days_in_status}d in ${esc(i.status_label)}</span></div>
  </article>`;
}

function renderBoard() {
  $('inBoard').innerHTML = BOARD.map(s => {
    const items = st.intros.filter(i => i.status === s);
    return `<section class="dl-col" data-status="${s}" aria-label="${esc(st.labels[s])}">
      <div class="dl-col-head"><div class="dl-col-title">${esc(st.labels[s])} <span class="dl-count">${items.length}</span></div></div>
      <div class="dl-col-body">${items.map(card).join('') || `<div class="dl-empty-col">${s === 'converted' ? 'Drop here to convert' : 'Nothing here'}</div>`}</div>
    </section>`;
  }).join('');
  const closed = st.intros.filter(i => ['declined', 'stale'].includes(i.status));
  $('inClosed').innerHTML = closed.length ? `<details><summary>Declined ${st.summary.declined || 0} · Stale ${st.summary.stale || 0}</summary>
    <div class="dl-closed-grid">${closed.map(card).join('')}</div></details>` : '';
  const triage = st.intros.filter(i => i.needs_triage);
  $('inTriage').hidden = !triage.length;
  $('inTriage').innerHTML = triage.length ? `<i class="fa-solid fa-inbox"></i> <strong>${triage.length}</strong> partner submission${triage.length === 1 ? '' : 's'}
    need${triage.length === 1 ? 's' : ''} linking to an account: ${triage.slice(0, 4).map(i => `<button type="button" class="in-link" data-open-intro="${i.id}">${esc(i.submitted.account_name)}</button>`).join(', ')}` : '';
  const open = st.intros.filter(i => OPEN.includes(i.status)).length;
  const conv = st.summary.converted || 0;
  const total = st.intros.length;
  $('inSummary').textContent = total
    ? `${open} open · ${conv} converted${total ? ` (${Math.round(conv / total * 100)}% of ${total})` : ''}`
    : 'No introductions yet — log the first warm intro from a partner or advisor.';
}

function params() {
  const p = new URLSearchParams();
  if ($('inConnector').value) p.set('connector_id', $('inConnector').value);
  if ($('inBusinessLine').value) p.set('business_line_id', $('inBusinessLine').value);
  if ($('inMine').checked) p.set('mine', 'true');
  if ($('inSearch').value.trim()) p.set('q', $('inSearch').value.trim());
  return p;
}

async function loadIntros() {
  try {
    const data = await api(`/api/crm/introductions?${params()}`);
    st.intros = data.introductions;
    st.summary = data.summary;
    st.labels = Object.fromEntries(data.statuses.map(x => [x.key, x.label]));
    renderBoard();
  } catch (err) { $('inSummary').textContent = err.message; }
}

async function loadConnectors() {
  const data = await api('/api/crm/connectors');
  st.connectors = data.connectors;
  st.defaultPct = data.default_attribution_pct;
  const keep = $('inConnector').value;
  $('inConnector').innerHTML = '<option value="">All connectors</option>' + st.connectors.map(c =>
    `<option value="${c.id}">${esc(c.name)}${c.active ? '' : ' (inactive)'}</option>`).join('');
  $('inConnector').value = keep;
}

// ── Drawer ───────────────────────────────────────────────────────────────────
function field(label, input, wide = false) { return `<label class="dl-field${wide ? ' dl-field-wide' : ''}">${label}${input}</label>`; }

function renderRoom() {
  const i = st.intro;
  if (!i) return;
  const ro = readOnly();
  const converted = i.status === 'converted';
  const closed = ['declined', 'stale'].includes(i.status);
  const idx = BOARD.indexOf(i.status);
  const blOptions = `<option value="">— Not set —</option>${(st.meta.business_lines || []).filter(b => b.active).map(b =>
    `<option value="${b.id}"${b.id === i.business_line_id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}`;
  $('inRoom').innerHTML = `
    <div class="dl-room-head">
      <div class="dl-room-head-row">
        <div><h2 class="dl-room-title" id="inRoomTitle">${esc(contactOf(i))}</h2>
          <div class="dl-room-acct">${i.account_id ? `<a href="/?account=${i.account_id}">${esc(accountOf(i))}</a>` : esc(accountOf(i))}
            · via <strong>${esc(i.connector.name)}</strong> <span class="in-pill">${esc(KIND_LABEL[i.connector.kind] || i.connector.kind)}</span></div></div>
        <button type="button" class="dl-icon" data-close-room aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="dl-stepper" role="group" aria-label="Status">${BOARD.map((s, n) =>
        `<button type="button" class="dl-step${n < idx && !closed ? ' done' : ''}${s === i.status ? ' current' : ''}" data-status-step="${s}"
          aria-current="${s === i.status ? 'step' : 'false'}"${ro || converted ? ' disabled' : ''}>${esc(st.labels[s])}</button>`).join('')}</div>
      ${closed ? `<div class="dl-warn">This introduction is <strong>${esc(i.status_label)}</strong>${i.closed_reason ? ` — ${esc(i.closed_reason)}` : ''}.
          ${ro ? '' : '<button type="button" class="dl-btn" data-reopen>Reopen</button>'}</div>`
        : (!converted && !ro ? `<div class="dl-close-btns" id="inActions">
          <button type="button" class="dl-btn dl-btn-primary" data-show-convert${i.account_id ? '' : ' disabled title="Link an account first"'}><i class="fa-solid fa-trophy"></i> Convert to deal</button>
          <button type="button" class="dl-btn dl-btn-danger" data-decline><i class="fa-solid fa-circle-xmark"></i> Decline</button></div>` : '')}
    </div>
    <div class="dl-room-body">
      ${i.needs_triage ? `<div class="dl-section in-triage-box"><h3 class="dl-h3"><i class="fa-solid fa-inbox"></i> Partner submission — link it</h3>
        <p class="in-muted">Submitted: <strong>${esc(i.submitted.account_name)}</strong> · ${esc(i.submitted.contact_name || '')}
          ${i.submitted.contact_title ? ` (${esc(i.submitted.contact_title)})` : ''}${i.submitted.contact_email ? ` · ${esc(i.submitted.contact_email)}` : ''}</p>
        ${ro ? '' : `<div class="dl-add-row" style="margin-top:6px"><select id="inTriageAccount" aria-label="Account">
          <option value="">Choose the account…</option>${st.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
          <button type="button" class="dl-btn dl-btn-primary" data-link-account>Link account</button></div>`}</div>` : ''}

      ${i.deal ? `<div class="dl-section in-deal"><h3 class="dl-h3"><i class="fa-solid fa-diagram-next"></i> Opportunity</h3>
        <a class="in-deal-card" href="/deals?deal=${i.deal.id}"><strong>${esc(i.deal.name)}</strong>
          <span>${esc(i.deal.stage)} · ${esc(money(i.deal.value_amount, i.deal.currency))}</span>
          <span>${i.attribution_pct}% attributed to ${esc(i.connector.name)}${i.attributed_value != null ? ` = ${esc(money(i.attributed_value, i.deal.currency))}` : ''}</span></a></div>` : ''}

      <div class="in-convert" id="inConvert" hidden></div>

      <div class="dl-grid">
        ${i.account_id ? field('Contact', `<div class="in-picker"><input id="inPersonSearch" placeholder="Search people…" ${ro ? 'disabled' : ''} aria-label="Search contact">
          <select data-f="persona_id" ${ro ? 'disabled' : ''}><option value="">${esc(i.persona_name || '— Not chosen —')}</option></select></div>`, true) : ''}
        ${field('Business line', `<select data-f="business_line_id" ${ro ? 'disabled' : ''}>${blOptions}</select>`)}
        ${field('Attribution %', `<input type="number" min="0" max="100" step="5" data-f="attribution_pct" value="${i.attribution_pct ?? ''}"
            placeholder="${esc(String(st.defaultPct))} (default)" ${ro ? 'disabled' : ''}>`)}
        ${field('Next step', `<input data-f="next_step" maxlength="500" value="${esc(i.next_step || '')}" placeholder="What happens next?" ${ro ? 'disabled' : ''}>`, true)}
        <div class="dl-field">Owner<div class="in-owner">${esc(i.owner_name || 'Unassigned')}
          ${ro || (st.meta.me && i.owner_user_id === st.meta.me.id) ? '' : '<button type="button" class="in-link" data-assign-me>Assign to me</button>'}</div></div>
        ${field('Context', `<textarea data-f="context" maxlength="4000" rows="3" ${ro ? 'disabled' : ''}>${esc(i.context || '')}</textarea>`, true)}
      </div>

      ${i.account_id ? '<div class="dl-section"><h3 class="dl-h3">Customer activity</h3><div id="inActivity"></div></div>' : ''}

      <div class="dl-section"><h3 class="dl-h3">Introduction history</h3>
        ${ro ? '' : `<form class="dl-note-form" id="inNoteForm"><textarea id="inNote" maxlength="2000" placeholder="Add a note…" aria-label="Note"></textarea>
          <div class="in-note-side"><label class="dl-toggle"><input type="checkbox" id="inNotePartner"${i.connector.has_login ? '' : ' disabled title="This connector has no partner login"'}> Visible to partner</label>
          <button type="submit" class="dl-btn dl-btn-primary">Add</button></div></form>`}
        <ul class="dl-timeline">${[...i.events].reverse().map(e => `<li><i class="fa-solid ${EVENT_ICON[e.kind] || 'fa-circle'}"></i>
          <div>${e.kind === 'status' || e.kind === 'converted' || e.kind === 'created'
            ? `${e.from_label ? `${esc(e.from_label)} → ` : ''}<strong>${esc(e.to_label || '')}</strong>${e.note ? ` — ${esc(e.note)}` : ''}`
            : esc(e.note || '')}
            ${e.partner_visible === false ? '<span class="in-pill">internal</span>' : ''}
            <div class="dl-when">${esc(e.by || 'System')} · ${esc(ago(e.at))}</div></div></li>`).join('')}</ul>
      </div>
    </div>`;
  if (i.account_id && $('inActivity')) {
    mountTimeline($('inActivity'), { objectType: 'introduction', objectId: i.id, accountId: i.account_id, personaId: i.persona_id || null,
      dealId: i.deal ? i.deal.id : null,
      onChange: () => { api(`/api/crm/introductions/${i.id}`).then(fresh => { if (st.intro && st.intro.id === fresh.id && fresh.status !== st.intro.status) { st.intro = fresh; renderRoom(); } loadIntros(); }).catch(() => {}); } });
  }
}

async function openIntro(id) {
  try {
    st.intro = await api(`/api/crm/introductions/${id}`);
    $('inOverlay').hidden = false;
    $('inRoom').hidden = false;
    renderRoom();
    const url = new URL(location.href); url.searchParams.set('intro', id); history.replaceState(null, '', url);
    $('inRoom').querySelector('[data-close-room]').focus();
  } catch (err) { showToast(err.message); }
}

function closeRoom() {
  $('inOverlay').hidden = true;
  $('inRoom').hidden = true;
  st.intro = null;
  const url = new URL(location.href); url.searchParams.delete('intro'); history.replaceState(null, '', url);
}

async function patchIntro(body, id = st.intro && st.intro.id) {
  try {
    const out = await api(`/api/crm/introductions/${id}`, { method: 'PATCH', body });
    if (st.intro && st.intro.id === id) { st.intro = out; renderRoom(); }
    loadIntros();
    return out;
  } catch (err) { showToast(err.message); return null; }
}

function inlinePrompt(container, placeholder, okLabel) {
  return new Promise((resolve) => {
    container.innerHTML = `<input class="in-inline-input" maxlength="500" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
      <button type="button" class="dl-btn dl-btn-primary" data-ok>${esc(okLabel)}</button><button type="button" class="dl-btn" data-cancel>Cancel</button>`;
    const input = container.querySelector('input');
    input.focus();
    const done = (v) => { resolve(v); renderRoom(); };
    container.querySelector('[data-ok]').onclick = () => { if (input.value.trim()) done(input.value.trim()); else input.focus(); };
    container.querySelector('[data-cancel]').onclick = () => done(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); container.querySelector('[data-ok]').click(); } if (e.key === 'Escape') done(null); };
  });
}

async function showConvert() {
  const i = st.intro;
  const box = $('inConvert');
  let deals = [];
  try { deals = (await api(`/api/deals?account_id=${i.account_id}&include_closed=false`)).deals.filter(d => !d.introduction); } catch { /* optional */ }
  const blOptions = `<option value="">— Not set —</option>${(st.meta.business_lines || []).filter(b => b.active).map(b =>
    `<option value="${b.id}"${b.id === i.business_line_id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}`;
  box.innerHTML = `<h3 class="dl-h3"><i class="fa-solid fa-trophy"></i> Convert to an opportunity</h3>
    <div class="in-radio"><label><input type="radio" name="inConvMode" value="new" checked> Create a new deal (Intro stage)</label>
      <label><input type="radio" name="inConvMode" value="link"${deals.length ? '' : ' disabled'}> Link an existing deal${deals.length ? ` (${deals.length})` : ' (none open)'}</label></div>
    <div class="dl-grid" id="inConvNew">
      ${field('Deal name', `<input id="inConvName" maxlength="200" value="${esc(`${accountOf(i)} — intro via ${i.connector.name}`)}">`, true)}
      ${field('Value', '<input id="inConvValue" type="number" min="0" step="1000" placeholder="250000">')}
      ${field('Currency', '<select id="inConvCurrency"><option>USD</option><option>EUR</option><option>GBP</option><option>INR</option></select>')}
      ${field('Expected close', '<input id="inConvClose" type="date">')}
      ${field('Business line', `<select id="inConvBl">${blOptions}</select>`)}
    </div>
    <div id="inConvLink" hidden>${field('Deal', `<select id="inConvDeal">${deals.map(d => `<option value="${d.id}">${esc(d.name)} · ${esc(d.stage_label)}</option>`).join('')}</select>`, true)}</div>
    <div class="dl-grid">${field('Attribution %', `<input id="inConvPct" type="number" min="0" max="100" step="5" value="${i.attribution_pct ?? st.defaultPct}">`)}</div>
    <div class="in-convert-foot"><button type="button" class="dl-btn" data-cancel-convert>Cancel</button>
      <button type="button" class="dl-btn dl-btn-primary" data-do-convert><i class="fa-solid fa-trophy"></i> Convert</button></div>`;
  box.hidden = false;
  box.querySelectorAll('input[name="inConvMode"]').forEach(r => r.addEventListener('change', () => {
    const link = box.querySelector('input[name="inConvMode"]:checked').value === 'link';
    $('inConvNew').hidden = link; $('inConvLink').hidden = !link;
  }));
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('inConvName').focus();
}

async function doConvert() {
  const link = document.querySelector('input[name="inConvMode"]:checked').value === 'link';
  const pct = $('inConvPct').value === '' ? null : Number($('inConvPct').value);
  const body = link ? { deal_id: Number($('inConvDeal').value), attribution_pct: pct } : {
    name: $('inConvName').value.trim(), value_amount: $('inConvValue').value === '' ? null : Number($('inConvValue').value),
    currency: $('inConvCurrency').value, expected_close: $('inConvClose').value || null,
    business_line_id: $('inConvBl').value ? Number($('inConvBl').value) : null, attribution_pct: pct,
  };
  try {
    const out = await api(`/api/crm/introductions/${st.intro.id}/convert`, { method: 'POST', body });
    st.intro = out;
    renderRoom();
    loadIntros();
    showToast('Converted — the deal is on the pipeline board');
  } catch (err) { showToast(err.message); }
}

let personTimer = null;
async function searchPeople(q) {
  const sel = $('inRoom').querySelector('[data-f="persona_id"]');
  if (!sel || !st.intro.account_id) return;
  try {
    const people = await api(`/api/crm/people?account_id=${st.intro.account_id}&q=${encodeURIComponent(q)}`);
    sel.innerHTML = `<option value="">${esc(st.intro.persona_name || '— Not chosen —')}</option>` + people.map(p =>
      `<option value="${p.id}">${esc(p.name)}${p.title ? ` — ${esc(p.title)}` : ''}</option>`).join('');
    if (people.length) sel.size = Math.min(6, people.length + 1);
  } catch { /* ignore */ }
}

function wireRoom() {
  const room = $('inRoom');
  room.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-close-room]')) { closeRoom(); return; }
    const step = t.closest('[data-status-step]');
    if (step && !step.disabled && step.dataset.statusStep !== st.intro.status) {
      if (step.dataset.statusStep === 'converted') { if (st.intro.account_id) showConvert(); else showToast('Link an account first'); return; }
      patchIntro({ status: step.dataset.statusStep });
      return;
    }
    if (t.closest('[data-show-convert]')) { showConvert(); return; }
    if (t.closest('[data-cancel-convert]')) { $('inConvert').hidden = true; return; }
    if (t.closest('[data-do-convert]')) { doConvert(); return; }
    if (t.closest('[data-decline]')) {
      const reason = await inlinePrompt($('inActions'), 'Why is it declined? (required)', 'Decline');
      if (reason) patchIntro({ status: 'declined', closed_reason: reason });
      return;
    }
    if (t.closest('[data-reopen]')) { patchIntro({ status: 'proposed' }); return; }
    if (t.closest('[data-assign-me]')) { patchIntro({ owner_user_id: st.meta.me.id }); return; }
    if (t.closest('[data-link-account]')) {
      const a = $('inTriageAccount').value;
      if (!a) { showToast('Choose the account first'); return; }
      patchIntro({ account_id: Number(a) });
    }
  });
  room.addEventListener('change', (e) => {
    const t = e.target;
    const f = t.dataset.f;
    if (!f) return;
    let v = t.value;
    if (['persona_id', 'business_line_id', 'attribution_pct'].includes(f)) v = v === '' ? null : Number(v);
    else v = v.trim() || null;
    if (f === 'persona_id' && v == null) return;
    patchIntro({ [f]: v });
  });
  room.addEventListener('input', (e) => {
    if (e.target.id !== 'inPersonSearch') return;
    clearTimeout(personTimer);
    const q = e.target.value.trim();
    personTimer = setTimeout(() => searchPeople(q), 200);
  });
  room.addEventListener('focusin', (e) => { if (e.target.id === 'inPersonSearch') searchPeople(e.target.value.trim()); });
  room.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id !== 'inNoteForm') return;
    const text = $('inNote').value.trim();
    if (!text) return;
    try {
      st.intro = await api(`/api/crm/introductions/${st.intro.id}/notes`, { method: 'POST', body: { text, partner_visible: $('inNotePartner').checked } });
      renderRoom();
    } catch (err) { showToast(err.message); }
  });
}

// ── New introduction ─────────────────────────────────────────────────────────
async function ensureAccounts() {
  if (st.accounts.length) return;
  const res = await fetch('/api/copilot/context');
  if (!res.ok) throw new Error(`Couldn't load accounts (${res.status})`);
  st.accounts = (await res.json()).accounts || [];
}

async function openNew() {
  try { await ensureAccounts(); } catch (err) { showToast(err.message); return; }
  $('inNewForm').reset();
  $('inNewConnectorBox').hidden = true;
  $('inNewConnector').innerHTML = st.connectors.filter(c => c.active).map(c =>
    `<option value="${c.id}">${esc(c.name)}${c.organisation ? ` — ${esc(c.organisation)}` : ''}</option>`).join('')
    || '<option value="">No connectors yet — add one below</option>';
  if (!st.connectors.some(c => c.active)) $('inNewConnectorBox').hidden = false;
  $('inNewAccount').innerHTML = st.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('inNewBusinessLine').innerHTML = '<option value="">— Not set —</option>' + (st.meta.business_lines || []).filter(b => b.active)
    .map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  $('inNewStatus').innerHTML = OPEN.map(s => `<option value="${s}">${esc(st.labels[s] || s)}</option>`).join('');
  $('inNewContact').innerHTML = '<option value="">— Not chosen yet —</option>';
  $('inModal').hidden = false;
  $('inNewConnector').focus();
}

async function newContactSearch() {
  const a = $('inNewAccount').value;
  if (!a) return;
  try {
    const people = await api(`/api/crm/people?account_id=${a}&q=${encodeURIComponent($('inNewContactSearch').value.trim())}`);
    $('inNewContact').innerHTML = '<option value="">— Not chosen yet —</option>' + people.map(p =>
      `<option value="${p.id}">${esc(p.name)}${p.title ? ` — ${esc(p.title)}` : ''}</option>`).join('');
  } catch { /* ignore */ }
}

function wireNew() {
  $('inNew').addEventListener('click', openNew);
  $('inModal').addEventListener('click', (e) => { if (e.target.closest('[data-close-modal]') || e.target === $('inModal')) $('inModal').hidden = true; });
  $('inNewConnectorToggle').addEventListener('click', () => { $('inNewConnectorBox').hidden = !$('inNewConnectorBox').hidden; if (!$('inNewConnectorBox').hidden) $('inNcName').focus(); });
  let t = null;
  $('inNewContactSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(newContactSearch, 200); });
  $('inNewAccount').addEventListener('change', () => { $('inNewContactSearch').value = ''; newContactSearch(); });
  $('inNewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      let connectorId = Number($('inNewConnector').value) || null;
      if (!$('inNewConnectorBox').hidden && $('inNcName').value.trim()) {
        const c = await api('/api/crm/connectors', { method: 'POST', body: { name: $('inNcName').value.trim(), kind: $('inNcKind').value, organisation: $('inNcOrg').value.trim() || null } });
        connectorId = c.id;
        await loadConnectors();
      }
      if (!connectorId) { showToast('Choose or add a connector'); return; }
      const out = await api('/api/crm/introductions', { method: 'POST', body: {
        connector_id: connectorId, account_id: Number($('inNewAccount').value),
        persona_id: $('inNewContact').value ? Number($('inNewContact').value) : null,
        business_line_id: $('inNewBusinessLine').value ? Number($('inNewBusinessLine').value) : null,
        status: $('inNewStatus').value, context: $('inNewContext').value.trim() || null,
      } });
      $('inModal').hidden = true;
      await loadIntros();
      openIntro(out.id);
      showToast('Introduction logged');
    } catch (err) { showToast(err.message); }
  });
}

// ── Attribution & connectors views ──────────────────────────────────────────
async function renderAttribution() {
  const box = $('inViewAttribution');
  box.innerHTML = '<p class="in-muted">Loading…</p>';
  try {
    const p = new URLSearchParams();
    if ($('inBusinessLine').value) p.set('business_line_id', $('inBusinessLine').value);
    const data = await api(`/api/crm/introductions/attribution?${p}`);
    const rows = data.connectors;
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    box.innerHTML = `<div class="in-view-head"><p class="in-muted">Sourced = value of deals that came from the connector's introductions.
        Attributed = sourced × the intro's attribution % (default ${esc(String(st.defaultPct))}%).${data.note ? ` ${esc(data.note)}` : ''}</p>
      <button type="button" class="dl-btn" data-export-attribution><i class="fa-regular fa-file-excel"></i> Export</button></div>
      <div class="in-kpis">
        <div><span>Introductions</span><strong>${sum('intros')}</strong></div>
        <div><span>Converted</span><strong>${sum('converted')}</strong></div>
        <div><span>Attributed pipeline</span><strong>${esc(money(sum('attributed_pipeline')))}</strong></div>
        <div><span>Attributed won</span><strong>${esc(money(sum('attributed_won')))}</strong></div>
      </div>
      ${rows.length ? `<div class="in-table-wrap"><table class="in-table"><thead><tr><th scope="col">Connector</th><th scope="col">Intros</th><th scope="col">Open</th>
        <th scope="col">Intros made</th><th scope="col">Converted</th><th scope="col">Conv. %</th><th scope="col">Sourced pipeline</th><th scope="col">Attributed pipeline</th>
        <th scope="col">Sourced won</th><th scope="col">Attributed won</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td><button type="button" class="in-link" data-filter-connector="${r.id}">${esc(r.name)}</button>
            <div class="in-muted">${esc(KIND_LABEL[r.kind] || r.kind)}${r.organisation ? ` · ${esc(r.organisation)}` : ''}</div></td>
          <td>${r.intros}</td><td>${r.open}</td><td>${r.intros_made}</td><td>${r.converted}</td><td>${r.conversion_rate}%</td>
          <td>${esc(money(r.sourced_pipeline))}</td><td>${esc(money(r.attributed_pipeline))}</td>
          <td>${esc(money(r.sourced_won))}</td><td><strong>${esc(money(r.attributed_won))}</strong></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="in-muted">No introductions yet.</p>'}`;
  } catch (err) { box.innerHTML = `<p class="in-muted">${esc(err.message)}</p>`; }
}

function renderConnectors() {
  const box = $('inViewConnectors');
  const ro = readOnly();
  const admin = st.meta.me && (st.meta.me.role === 'super_admin' || !st.meta.auth_enforced);
  const freePartners = st.partnerUsers.filter(u => !st.connectors.some(c => c.user_id === u.id));
  box.innerHTML = `${ro ? '' : `<form class="in-conn-form" id="inConnForm">
      <input id="inCfName" maxlength="200" placeholder="Name (person or firm)" required aria-label="Connector name">
      <select id="inCfKind" aria-label="Kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <input id="inCfOrg" maxlength="200" placeholder="Organisation" aria-label="Organisation">
      <input id="inCfEmail" maxlength="255" type="email" placeholder="Work email" aria-label="Work email">
      <input id="inCfPct" type="number" min="0" max="100" step="5" placeholder="Attribution % (${esc(String(st.defaultPct))})" aria-label="Default attribution %">
      <button type="submit" class="dl-btn dl-btn-primary"><i class="fa-solid fa-plus"></i> Add connector</button></form>`}
    <div class="in-table-wrap"><table class="in-table"><thead><tr><th scope="col">Connector</th><th scope="col">Kind</th><th scope="col">Default %</th>
      <th scope="col">Intros</th><th scope="col">Open</th><th scope="col">Converted</th><th scope="col">Partner login</th><th scope="col">Active</th></tr></thead><tbody>
    ${st.connectors.map(c => `<tr data-connector="${c.id}"><td><strong>${esc(c.name)}</strong><div class="in-muted">${esc(c.organisation || '')}${c.email ? ` · ${esc(c.email)}` : ''}</div></td>
      <td>${esc(KIND_LABEL[c.kind] || c.kind)}</td>
      <td><input type="number" min="0" max="100" step="5" class="in-pct" data-cf="default_attribution_pct" value="${c.default_attribution_pct ?? ''}" placeholder="${esc(String(st.defaultPct))}" ${ro ? 'disabled' : ''} aria-label="Default attribution %"></td>
      <td>${c.intros}</td><td>${c.open}</td><td>${c.converted}</td>
      <td>${c.user_id ? `${esc(c.login_email || '')}${admin ? ` <a class="in-link" href="/partner?connector_id=${c.id}" target="_blank" rel="noopener">Preview</a> <button type="button" class="in-link" data-unlink>Unlink</button>` : ''}`
        : (admin ? `<select data-link-login aria-label="Link partner login"><option value="">Link a partner login…</option>${freePartners.map(u =>
          `<option value="${u.id}">${esc(u.full_name || u.email)}</option>`).join('')}</select>` : '<span class="in-muted">—</span>')}</td>
      <td><input type="checkbox" data-cf="active" ${c.active ? 'checked' : ''} ${ro ? 'disabled' : ''} aria-label="Active"></td></tr>`).join('')
      || '<tr><td colspan="8" class="in-muted">No connectors yet.</td></tr>'}</tbody></table></div>
    ${admin ? '<p class="in-muted">Partner logins are users with the Partner / Advisor role (create them on the Admin page). A linked partner sees only their own introductions.</p>' : ''}`;
}

function wireViews() {
  document.querySelectorAll('.in-tab').forEach(tab => tab.addEventListener('click', () => {
    st.view = tab.dataset.view;
    document.querySelectorAll('.in-tab').forEach(t => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    $('inViewBoard').hidden = st.view !== 'board';
    $('inViewAttribution').hidden = st.view !== 'attribution';
    $('inViewConnectors').hidden = st.view !== 'connectors';
    if (st.view === 'attribution') renderAttribution();
    if (st.view === 'connectors') renderConnectors();
  }));
  $('inViewAttribution').addEventListener('click', (e) => {
    if (e.target.closest('[data-export-attribution]')) {
      downloadFile('/api/crm/introductions/attribution/export', 'introduction-attribution.xlsx').catch(err => showToast(err.message));
      return;
    }
    const f = e.target.closest('[data-filter-connector]');
    if (f) { $('inConnector').value = f.dataset.filterConnector; document.querySelector('.in-tab[data-view="board"]').click(); loadIntros(); }
  });
  const conn = $('inViewConnectors');
  conn.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/crm/connectors', { method: 'POST', body: {
        name: $('inCfName').value.trim(), kind: $('inCfKind').value, organisation: $('inCfOrg').value.trim() || null,
        email: $('inCfEmail').value.trim() || null, default_attribution_pct: $('inCfPct').value === '' ? null : Number($('inCfPct').value),
      } });
      await loadConnectors();
      renderConnectors();
      showToast('Connector added');
    } catch (err) { showToast(err.message); }
  });
  conn.addEventListener('change', async (e) => {
    const row = e.target.closest('[data-connector]');
    if (!row) return;
    const id = row.dataset.connector;
    let body = null;
    if (e.target.dataset.cf === 'active') body = { active: e.target.checked };
    else if (e.target.dataset.cf === 'default_attribution_pct') body = { default_attribution_pct: e.target.value === '' ? null : Number(e.target.value) };
    else if (e.target.hasAttribute('data-link-login') && e.target.value) body = { user_id: Number(e.target.value) };
    if (!body) return;
    try { await api(`/api/crm/connectors/${id}`, { method: 'PATCH', body }); await loadConnectors(); renderConnectors(); showToast('Saved'); }
    catch (err) { showToast(err.message); renderConnectors(); }
  });
  conn.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-unlink]')) return;
    const id = e.target.closest('[data-connector]').dataset.connector;
    try { await api(`/api/crm/connectors/${id}`, { method: 'PATCH', body: { unlink_user: true } }); await loadConnectors(); renderConnectors(); }
    catch (err) { showToast(err.message); }
  });
}

// ── Board interactions ───────────────────────────────────────────────────────
function wireBoard() {
  const board = $('inBoard');
  const openCard = (e) => { const c = e.target.closest('[data-intro]'); if (c) openIntro(Number(c.dataset.intro)); };
  board.addEventListener('click', openCard);
  $('inClosed').addEventListener('click', openCard);
  $('inTriage').addEventListener('click', (e) => { const b = e.target.closest('[data-open-intro]'); if (b) openIntro(Number(b.dataset.openIntro)); });
  board.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-intro]')) { e.preventDefault(); openCard(e); } });
  board.addEventListener('dragstart', (e) => {
    const c = e.target.closest('[data-intro]');
    if (!c) return;
    st.dragId = Number(c.dataset.intro);
    c.classList.add('dragging');
    e.dataTransfer.setData('text/plain', c.dataset.intro);
  });
  board.addEventListener('dragend', (e) => { const c = e.target.closest('[data-intro]'); if (c) c.classList.remove('dragging'); });
  board.addEventListener('dragover', (e) => { const col = e.target.closest('.dl-col'); if (col && st.dragId) { e.preventDefault(); col.classList.add('drop-hover'); } });
  board.addEventListener('dragleave', (e) => { const col = e.target.closest('.dl-col'); if (col) col.classList.remove('drop-hover'); });
  board.addEventListener('drop', async (e) => {
    const col = e.target.closest('.dl-col');
    if (!col || !st.dragId) return;
    e.preventDefault();
    col.classList.remove('drop-hover');
    const id = st.dragId; st.dragId = null;
    const intro = st.intros.find(i => i.id === id);
    if (!intro || intro.status === col.dataset.status) return;
    if (col.dataset.status === 'converted') { await openIntro(id); if (st.intro.account_id) showConvert(); else showToast('Link an account first'); return; }
    patchIntro({ status: col.dataset.status }, id);
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    st.meta = await api('/api/crm/meta');
    await loadConnectors();
    ensureAccounts().catch(() => {});
    if (st.meta.me.role === 'super_admin' || !st.meta.auth_enforced) {
      api('/api/crm/team').then(t => { st.partnerUsers = t.filter(u => u.role === 'partner' && u.is_active); }).catch(() => {});
    }
  } catch (err) { showToast(err.message); return; }
  $('inBusinessLine').innerHTML = '<option value="">All business lines</option>' + (st.meta.business_lines || [])
    .map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  if (readOnly()) $('inNew').hidden = true;
  const p = new URLSearchParams(location.search);
  if (p.get('connector_id')) $('inConnector').value = p.get('connector_id');
  let t = null;
  $('inSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadIntros, 250); });
  ['inConnector', 'inMine'].forEach(id => $(id).addEventListener('change', loadIntros));
  $('inBusinessLine').addEventListener('change', () => { loadIntros(); if (st.view === 'attribution') renderAttribution(); });
  $('inExport').addEventListener('click', () => {
    const q = new URLSearchParams();
    if ($('inConnector').value) q.set('connector_id', $('inConnector').value);
    downloadFile(`/api/crm/introductions/export?${q}`, 'introductions.xlsx').catch(err => showToast(err.message));
  });
  $('inOverlay').addEventListener('click', closeRoom);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('inModal').hidden) $('inModal').hidden = true;
    else if (!$('inRoom').hidden) closeRoom();
  });
  wireBoard();
  wireRoom();
  wireNew();
  wireViews();
  await loadIntros();
  if (p.get('intro')) openIntro(Number(p.get('intro')));
  if (p.get('new') === '1') openNew();
}

initThemeToggle();
initTopbarAuth().then((user) => {
  if (!user) { document.body.style.display = 'none'; location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
  init();
});
