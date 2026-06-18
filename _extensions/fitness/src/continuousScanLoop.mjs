// Pure loop policy for the continuous biometric scanner. Side-effect functions
// (runScan / sendBus / delay) are injected so the policy is testable without a reader.
const SCAN_SETTLE_MS = 1500;        // after a real touch, pause so one press isn't re-emitted
const SCAN_REARM_BACKOFF_MS = 800;  // after busy/cancelled/error, quiet re-arm
const NO_TEMPLATES_BACKOFF_MS = 5000; // nothing enrolled yet — check back occasionally

export function createContinuousScanLoop({
  runScan,
  sendBus,
  delay,
  logger = console,
  maxIterations = Infinity,
}) {
  let active = false;

  async function run() {
    active = true;
    let n = 0;
    while (active && n < maxIterations) {
      n += 1;
      let r;
      try {
        r = await runScan();
      } catch (err) {
        logger.error?.(`❌ continuous scan error: ${err.message}`);
        await delay(SCAN_REARM_BACKOFF_MS);
        continue;
      }
      if (!r || !r.ok) { await delay(SCAN_REARM_BACKOFF_MS); continue; } // reader-busy: enroll/manage owns it
      const result = r.value || {};
      if (result.matched && result.uuid) {
        sendBus('biometric.scan', { modality: 'fingerprint', matched: true, uuid: result.uuid });
        logger.log?.(`🔐 biometric.scan → matched (uuid=${result.uuid})`);
        await delay(SCAN_SETTLE_MS);
      } else if (result.reason === 'no-match') {
        sendBus('biometric.scan', { modality: 'fingerprint', matched: false });
        logger.log?.('🔐 biometric.scan → sensed, unrecognized');
        await delay(SCAN_SETTLE_MS);
      } else if (result.reason === 'no-templates') {
        await delay(NO_TEMPLATES_BACKOFF_MS);
      } else {
        // 'cancelled' (preempted by enroll/manage) or 'identify-error' → quiet re-arm
        await delay(SCAN_REARM_BACKOFF_MS);
      }
    }
  }

  function stop() { active = false; }

  return { run, stop };
}
