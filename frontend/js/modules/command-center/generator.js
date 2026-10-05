// Generated Command Center data — the Priority Signal Feed, This Week's
// Playbook, signal velocity and plays-in-motion counts. Nothing here is
// seeded: GET /api/command-center returns the caller's last generated
// snapshot (empty until they press Generate), and POST
// /api/command-center/generate rebuilds it from exec movements, LinkedIn
// jobs, news and opportunity signals in the DB
// (services/command_center_service.py).

const EMPTY = {
  generated_at: null,
  signals: [],
  playbook: [],
  velocity: null,
  source_counts: {},
  categories: ['Exec change', 'Hiring', 'News', 'Opportunity'],
  plays: { in_motion: 0, stalled: 0 },
};

let current = EMPTY;
let loadPromise = null;

function normalize(data) {
  return {
    ...EMPTY,
    ...data,
    signals: (data.signals || []).map(s => ({ ...s, detectedAt: new Date(s.detected_at) })),
    playbook: data.playbook || [],
    plays: data.plays || EMPTY.plays,
  };
}

export function loadCommandCenter() {
  if (!loadPromise) {
    loadPromise = fetch('/api/command-center')
      .then(res => { if (!res.ok) throw new Error(`Failed to load Command Center data (${res.status})`); return res.json(); })
      .then(data => { current = normalize(data); return current; })
      .catch(err => { console.error(err); current = EMPTY; return current; });
  }
  return loadPromise;
}

/** Runs the generator server-side and replaces the cached data. Throws
 * with the server's message on failure. */
export async function generateCommandCenter() {
  const res = await fetch('/api/command-center/generate', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Generation failed (${res.status})`);
  current = normalize(data);
  loadPromise = Promise.resolve(current);
  return current;
}

export function getCommandCenter() {
  return current;
}

export function isGenerated() {
  return Boolean(current.generated_at);
}

/** A playbook item was turned into a task — reflect it without a refetch. */
export function markPlayTasked(play) {
  if (play.tasked) return;
  play.tasked = true;
  current.plays = { ...current.plays, in_motion: current.plays.in_motion + 1 };
}
