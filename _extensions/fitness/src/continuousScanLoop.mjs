// Pure loop policy for the continuous biometric scanner. Side-effect functions
// (runScan / sendBus / delay) are injected so the policy is testable without a reader.
const SCAN_SETTLE_MS = 1500;        // after a real touch, pause so one press isn't re-emitted
const SCAN_REARM_BACKOFF_MS = 800;  // after busy/cancelled/error, quiet re-arm
const NO_TEMPLATES_BACKOFF_MS = 5000; // nothing enrolled yet — check back occasionally
const HEARTBEAT_ITERATIONS = 100;   // periodic health summary so the loop is provably alive over long uptime

// The U.are.U 4500 is purpose-built for continuous-identify duty, so hardware wear
// is a non-issue. The real long-uptime risk is the libfprint/uru4000 stack itself
// (each scan opens+closes the device — thousands of USB claim/release per day). So
// this loop logs every identify-error with its underlying message and a consecutive
// streak, and emits a periodic heartbeat: a rising error rate is the early signal
// that the reader is degrading and the container should be restarted.
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
    const stats = { matched: 0, unrecognized: 0, identifyErrors: 0, throws: 0, busy: 0, cancelled: 0, noTemplates: 0 };
    let consecutiveErrors = 0;
    let lastQuietReason = null; // throttle repetitive busy/no-templates lines to state transitions only

    const heartbeat = () => {
      logger.log?.(
        `🔐 scan-loop heartbeat: iter=${n} matched=${stats.matched} unrecognized=${stats.unrecognized} `
        + `identifyErrors=${stats.identifyErrors} throws=${stats.throws} busy=${stats.busy} cancelled=${stats.cancelled}`
      );
    };

    logger.log?.('🔐 scan-loop started');
    while (active && n < maxIterations) {
      n += 1;
      let r;
      let threw = false;
      try {
        r = await runScan();
      } catch (err) {
        // The runScan contract maps preemption/identify failures to result reasons,
        // so a real throw here is unexpected (arbiter / IPC fault). Always log it.
        threw = true;
        stats.throws += 1;
        consecutiveErrors += 1;
        lastQuietReason = null;
        logger.error?.(`❌ scan-loop throw (#${consecutiveErrors} consecutive): ${err.message}`);
        await delay(SCAN_REARM_BACKOFF_MS);
      }

      if (!threw) {
        if (!r || !r.ok) {
          // reader-busy: enroll/manage owns the device. Expected and transient —
          // log only the transition so a long enroll doesn't spam every 800ms.
          stats.busy += 1;
          if (lastQuietReason !== 'reader-busy') {
            logger.log?.('🔐 scan-loop paused: reader-busy (enroll/manage owns the device)');
            lastQuietReason = 'reader-busy';
          }
          await delay(SCAN_REARM_BACKOFF_MS);
        } else {
          const result = r.value || {};
          if (result.matched && result.uuid) {
            consecutiveErrors = 0;
            lastQuietReason = null;
            stats.matched += 1;
            sendBus('biometric.scan', { modality: 'fingerprint', matched: true, uuid: result.uuid });
            logger.log?.(`🔐 biometric.scan → matched (uuid=${result.uuid})`);
            await delay(SCAN_SETTLE_MS);
          } else if (result.reason === 'no-match') {
            consecutiveErrors = 0;
            lastQuietReason = null;
            stats.unrecognized += 1;
            sendBus('biometric.scan', { modality: 'fingerprint', matched: false });
            logger.log?.('🔐 biometric.scan → sensed, unrecognized');
            await delay(SCAN_SETTLE_MS);
          } else if (result.reason === 'no-templates') {
            // Nothing enrolled yet — log the transition once, then stay quiet.
            stats.noTemplates += 1;
            if (lastQuietReason !== 'no-templates') {
              logger.log?.('🔐 scan-loop idle: no fingerprints enrolled yet');
              lastQuietReason = 'no-templates';
            }
            await delay(NO_TEMPLATES_BACKOFF_MS);
          } else if (result.reason === 'cancelled') {
            // Preempted by enroll/manage — expected; reset the error streak and stay quiet.
            stats.cancelled += 1;
            consecutiveErrors = 0;
            await delay(SCAN_REARM_BACKOFF_MS);
          } else {
            // identify-error: THE driver-health signal. Surface every one with the
            // underlying message + consecutive streak so a degrading uru4000 / libfprint
            // binding shows up in logs before it wedges. A rising streak ⇒ restart.
            stats.identifyErrors += 1;
            consecutiveErrors += 1;
            lastQuietReason = null;
            const detail = result.error ? `: ${result.error}` : '';
            logger.warn?.(`⚠️ scan-loop identify-error (#${consecutiveErrors} consecutive)${detail}`);
            await delay(SCAN_REARM_BACKOFF_MS);
          }
        }
      }

      if (n % HEARTBEAT_ITERATIONS === 0) heartbeat();
    }
    logger.log?.(`🔐 scan-loop exited after ${n} iterations`);
  }

  function stop() { active = false; }

  return { run, stop };
}
