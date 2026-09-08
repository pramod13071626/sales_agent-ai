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

// first_seen (the ingestion timestamp) is null for a chunk of bulk-imported
// rows, so recency falls back through published_at / effective_date — both
// free-text fields scraped from the source article rather than real Date
// columns, hence the parse-and-skip-if-invalid approach.
function resolveDate(m) {
  for (const raw of [m.first_seen, m.published_at, m.effective_date]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Movements from the last 30 days, newest first. */
export async function loadRecentMovements() {
  const movements = await loadRawMovements();
  const actioned = getActionedSet();
  const cutoff = Date.now() - 30 * 86400000;
  return movements
    .map(m => ({ ...m, _date: resolveDate(m) }))
    .filter(m => m._date && m._date.getTime() >= cutoff)
    .map(m => ({
      id: m.id,
      person: m.person_name,
      role: m.designation || '—',
      company: m.account_name || m.company_name,
      type: (m.event_type || '').toLowerCase(), // joined | resigned | retired | promoted
      date: m._date,
      // effective_date is free text scraped from the source article — shown
      // when present since it reads better than a raw ingestion timestamp.
      displayDate: m.effective_date || null,
      actioned: actioned.has(m.id),
      accountId: m.account_id,
    }))
    .sort((a, b) => b.date - a.date);
}
