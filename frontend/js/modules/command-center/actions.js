import { showToast } from '../toast.js';

/** Simulated CRM sync — POSTs to /api/crm/tasks; the endpoint doesn't need to
 * exist for the demo to work, a failed/missing route still resolves the
 * optimistic UI update (this mirrors how a fire-and-forget CRM webhook would
 * be treated in production: the task is logged locally regardless). */
async function simulateCrmPost(payload) {
  try {
    await fetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // No CRM backend wired up in this demo — that's fine, the UI already optimistically updated.
  }
}

export function logTouch(accountName, context) {
  showToast(`Touch logged for ${accountName}${context ? ` — ${context}` : ''}`);
}

export function createTask(accountName, context) {
  simulateCrmPost({ type: 'task', account: accountName, context });
  showToast(`Task created for ${accountName}${context ? ` — ${context}` : ''}`);
}

export function pushToCrm(accountName, title) {
  simulateCrmPost({ type: 'crm_task', account: accountName, title });
  showToast(`Pushed to CRM: ${title}`);
}
