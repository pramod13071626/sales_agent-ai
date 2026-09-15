// Real executive-movement data for the Exec Movements Timeline (and the KPI
// strip's "Exec changes needing outreach" card) — GET /api/cxo-movements,
// which is genuinely real (not mock): person/company/role/event-type/date
// scraped from news coverage. The endpoint itself requires no auth and isn't
// scoped to granted accounts (it's public market intel, not account data),
// so this doesn't restrict it to the current user's accounts either —
// checked directly against the live data: several accounts' *recent*
// movements have no account_id link yet (the target_key → account match
// hasn't been made), so scoping by account here would have hidden real,
// current movements that a rep should still see.

let rawMovementsPromise = null;

function loadRawMovements() {
  if (!rawMovementsPromise) {
    rawMovementsPromise = fetch('/api/cxo-movements?limit=200')
      .then(res => { if (!res.ok) throw new Error(`Failed to load exec movements (${res.status})`); return res.json(); })
      .then(data => data.movements || []);
  }
  return rawMovementsPromise;
}

// There's no "actioned" column on cxo_movements — the DB has no concept of a
// rep having followed up on a movement. Tracked locally per browser instead.
const ACTIONED_KEY = 'cc_actioned_movements';

function getActionedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(ACTIONED_KEY) || '[]')); }
  catch (e) { return new Set(); }
}

export function markMovementActioned(id) {
  const set = getActionedSet();
  set.add(id);
  try { localStorage.setItem(ACTIONED_KEY, JSON.stringify([...set])); } catch (e) { /* private browsing / storage disabled */ }
}

// Resolve the actual event date from effective_date or published_at.
// DB ingestion timestamp (first_seen) is excluded to ensure only true last 30-day events appear.
function resolveDate(m) {
  for (const raw of [m.effective_date, m.published_at]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Movements strictly from the last 30 days, newest first. */
export async function loadRecentMovements() {
  const movements = await loadRawMovements();
  const actioned = getActionedSet();
  const now = Date.now();
  const cutoff = now - 30 * 86400000;
  return movements
    .map(m => ({ ...m, _date: resolveDate(m) }))
    .filter(m => m._date && m._date.getTime() >= cutoff && m._date.getTime() <= (now + 86400000))
    .map(m => ({
      id: m.id,
      person: m.person_name,
      role: m.designation || '—',
      company: m.account_name || m.company_name,
      type: (m.event_type || '').toLowerCase(), // joined | resigned | retired | promoted
      date: m._date,
      displayDate: m.effective_date || (m.published_at ? new Date(m.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null),
      actioned: actioned.has(m.id),
      accountId: m.account_id,
    }))
    .sort((a, b) => b.date - a.date);
}
