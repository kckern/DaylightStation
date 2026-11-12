// Harness-only stand-in for InvadersPoseBridge: no camera, no model. The page
// reports `?pose=loading|detecting|camera-denied` as the bridge status and
// hands the tracker to the shoot script, which feeds it poses.
import { useEffect } from 'react';

export default function InvadersPoseBridge({ tracker, onStatus }) {
  useEffect(() => {
    const state = new URLSearchParams(location.search).get('pose') || 'detecting';
    window.__si = window.__si || {};
    window.__si.tracker = tracker;
    window.__si.status = (next) => onStatus({ state: next, fps: 13, latency: 72, backend: 'wasm', modelType: 'full', error: next === 'camera-denied' ? 'Permission denied' : null });
    window.__si.status(state);
  }, [tracker, onStatus]);
  return null;
}
