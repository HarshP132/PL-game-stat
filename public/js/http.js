// Fetch JSON through our proxy, turning failures into readable error messages.
export async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.parse(text).message || ''; } catch { detail = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
    throw new Error(`HTTP ${res.status}${detail ? ` – ${detail}` : ''}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('the response was not JSON (the API may have moved)');
  }
}
