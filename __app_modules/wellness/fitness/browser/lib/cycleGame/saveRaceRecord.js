/**
 * Persist a finished race record with retry. A kiosk on flaky WiFi must not
 * lose a 20-minute race to one dropped POST — transient failures (network
 * throw or non-2xx) retry with backoff; only exhaustion reports failure so
 * the results board can show a "not saved" badge.
 *
 * Injectable fetch/sleep keep this unit-testable without timers.
 */
export async function saveRaceRecord({
  record,
  fetchFn = (...args) => fetch(...args),
  attempts = 3,
  backoffMs = [1000, 3000],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onAttempt = null
} = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const resp = await fetchFn('/api/v1/fitness/cycle-races', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record })
      });
      if (resp.ok) return { ok: true, attempt: i + 1 };
      lastError = `http_${resp.status}`;
    } catch (err) {
      lastError = err?.message || String(err);
    }
    onAttempt?.({ attempt: i + 1, error: lastError });
    if (i < attempts - 1) await sleep(backoffMs[Math.min(i, backoffMs.length - 1)]);
  }
  return { ok: false, attempt: attempts, error: lastError };
}

export default saveRaceRecord;
