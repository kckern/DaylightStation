// upload.js — POST recorded clips + the manifest to the backend.
export const API_BASE = '/api/v1/piano';

export async function uploadClip(runId, label, blob) {
  const res = await fetch(`${API_BASE}/effect-audit/${runId}/clip/${label}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: blob,
  });
  if (!res.ok) throw new Error(`clip upload ${label} failed: ${res.status}`);
  return res.json();
}

export async function uploadManifest(runId, manifest) {
  const res = await fetch(`${API_BASE}/effect-audit/${runId}/manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  if (!res.ok) throw new Error(`manifest upload failed: ${res.status}`);
  return res.json();
}
