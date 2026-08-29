const DEFAULT_COMMIT_PENDING_MAX_AGE_MS = 120000;

/**
 * Owns consumption of short-lived identity authorization for emergency actions.
 * The HTTP layer sees semantic outcomes, never the stateful identity relay or
 * biometric unlock broker.
 */
export class EmergencyAccessService {
  constructor({
    identityRelay = null,
    resolveUnlockService = () => null,
    manageAccess = null,
    clock = () => Date.now(),
    commitPendingMaxAgeMs = DEFAULT_COMMIT_PENDING_MAX_AGE_MS,
    logger = console,
  } = {}) {
    this.identityRelay = identityRelay;
    this.resolveUnlockService = resolveUnlockService;
    this.manageAccess = manageAccess;
    this.clock = clock;
    this.commitPendingMaxAgeMs = commitPendingMaxAgeMs;
    this.logger = logger;
  }

  consumeCommitAuthorization() {
    return this.identityRelay?.consumeArmedCommit?.(this.clock())
      || this.identityRelay?.consumePendingDetection?.(this.clock(), this.commitPendingMaxAgeMs)
      || null;
  }

  confirmAbort() {
    const pending = this.identityRelay?.consumePendingDetection?.(this.clock()) || null;
    if (pending) this.identityRelay?.disarmCommit?.();
    return pending;
  }

  async authorizeRelease(householdId) {
    const pending = this.identityRelay?.consumePendingDetection?.(this.clock()) || null;
    if (pending) return { kind: 'authorized', userId: pending.userId };

    const unlockService = this.resolveUnlockService?.();
    if (!unlockService) return { kind: 'unlock_unavailable' };

    const gallery = this.manageAccess?.emergencyAdminGallery?.(householdId) || [];
    if (gallery.length === 0) return { kind: 'no_candidates' };

    this.logger.info?.('emergency.release_scan_start', { candidates: gallery.length });
    let verdict;
    try {
      verdict = await unlockService.requestUnlock('emergency:release', gallery);
    } catch (error) {
      this.logger.error?.('emergency.release_scan_error', { message: error?.message ?? null });
      return { kind: 'scan_failed' };
    }
    if (!verdict?.matched) return { kind: 'denied', reason: verdict?.reason || 'no-match' };
    return { kind: 'authorized', userId: verdict.userId };
  }
}

export default EmergencyAccessService;
