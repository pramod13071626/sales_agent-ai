// Authenticated file download (fetch-instrumentation.js adds the bearer token),
// saved with the server's Content-Disposition filename. Used by the export buttons.
export async function downloadFile(url, fallbackName) {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const m = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
