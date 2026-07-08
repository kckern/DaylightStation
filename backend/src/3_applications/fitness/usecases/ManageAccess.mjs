// backend/src/3_applications/fitness/usecases/ManageAccess.mjs
//
// Fingerprint / manage-access AUTHORIZATION use case (security policy).
//
// This is the application-layer home for the fitness fingerprint-management
// authorization subsystem that used to live inline in the API router:
//   - the eligible-user policy (admins + primary, deduped),
//   - the emergency-admin fingerprint gallery,
//   - the self/admin identify GATE that guards enroll/delete,
//   - and the enroll/delete domain rules (eligibility, duplicate-finger guard,
//     trust-on-first-use, provider round-trip, profile.yml persistence).
//
// The router keeps ONLY request parsing + response shaping; every security
// DECISION is made here. Methods return `{ status, body }` (or plain data for
// the listing/gallery reads) so the router is a thin translator.

import {
  resolveManageAccess,
  resolveEligibleUsernames,
  resolveAdminUsernames,
} from '../manageAccessPolicy.mjs';
import { buildAuthz, buildFingerprintIdentityIndex } from '../identityRelay.mjs';

export class ManageAccess {
  #userService;
  #fitnessConfigService;
  #identityRelay;
  #resolveUnlockService;
  #resolveManageService;
  #fingerprintProfileWriter;
  #logger;

  /**
   * @param {object} deps
   * @param {object} deps.userService - profile reads (getProfile / getAllProfiles)
   * @param {object} deps.fitnessConfigService - loadRawConfig(householdId)
   * @param {object} [deps.identityRelay] - admin-session gate (adminVerifiedWithin)
   * @param {Function} [deps.resolveUnlockService] - () => unlock service (or null)
   * @param {Function} [deps.resolveManageService] - () => enroll/delete broker (or null)
   * @param {object} [deps.fingerprintProfileWriter] - persists profile.yml prints
   * @param {object} [deps.logger]
   */
  constructor({
    userService,
    fitnessConfigService,
    identityRelay = null,
    resolveUnlockService = () => null,
    resolveManageService = () => null,
    fingerprintProfileWriter = null,
    logger = console,
  } = {}) {
    this.#userService = userService || null;
    this.#fitnessConfigService = fitnessConfigService || null;
    this.#identityRelay = identityRelay;
    this.#resolveUnlockService = resolveUnlockService;
    this.#resolveManageService = resolveManageService;
    this.#fingerprintProfileWriter = fingerprintProfileWriter;
    this.#logger = logger || console;
  }

  #config(householdId) {
    return this.#fitnessConfigService?.loadRawConfig?.(householdId) || {};
  }

  /** Ordered, deduped eligible usernames (admins first, then primary). */
  eligibleUsernames(householdId) {
    return resolveEligibleUsernames(this.#config(householdId));
  }

  /**
   * Build the username->profile map (all eligible users) for the access decision,
   * so an admin's prints are available to the self/admin gallery. Reuses the live
   * profile cache.
   */
  #eligibleProfilesObject(householdId) {
    const map = {};
    for (const username of this.eligibleUsernames(householdId)) {
      const profile = this.#userService?.getProfile?.(username);
      if (profile) map[username] = profile;
    }
    return map;
  }

  /**
   * List every ELIGIBLE user (admins first, then primary, deduped) with their
   * admin flag and enrolled fingers (finger + date only). Never returns uuids;
   * never lists inline family/friends; hides simulated fixtures.
   */
  listFingerprints(householdId) {
    const adminSet = new Set(resolveAdminUsernames(this.#config(householdId)));
    const out = [];
    for (const username of this.eligibleUsernames(householdId)) {
      const profile = this.#userService?.getProfile?.(username);
      if (!profile) continue;
      const ids = profile.identities || {};
      out.push({
        username,
        displayName: profile.display_name || username,
        admin: adminSet.has(username) || ids.admin === true,
        // Simulated entries (sim-unlock test fixtures) are not real templates and
        // are never surfaced for management — they'd show as phantom duplicates.
        fingerprints: (ids.fingerprints || [])
          .filter((f) => !f.simulated)
          .map((f) => ({ finger: f.finger, enrolled: f.enrolled })),
      });
    }
    return out;
  }

  /**
   * Fingerprint candidate gallery for an emergency release: every admin's enrolled
   * prints, deduped by uuid. `admin` here is authoritative via buildAuthz (config
   * `users.admin`), the same authority that stamps an emergency `pending` detection
   * — so exactly the people who can trigger the lockdown can release it.
   */
  emergencyAdminGallery(householdId) {
    const fitnessConfig = this.#config(householdId);
    const profiles = this.#userService?.getAllProfiles?.() || {};
    const entries = profiles instanceof Map ? [...profiles.entries()] : Object.entries(profiles);
    const seen = new Set();
    const gallery = [];
    for (const [username, profile] of entries) {
      if (!buildAuthz(username, fitnessConfig).admin) continue;
      for (const fp of profile?.identities?.fingerprints || []) {
        if (!fp?.id || seen.has(fp.id)) continue;
        seen.add(fp.id);
        gallery.push({ uuid: fp.id, username });
      }
    }
    return gallery;
  }

  /**
   * Run the self/admin identify gate for managing `username`. Returns
   * { ok:true } when allowed (TOFU, active admin session, or matched scan), else
   * { ok:false, status, body }.
   */
  async gate(householdId, username) {
    const logger = this.#logger;
    const profiles = this.#eligibleProfilesObject(householdId);
    const { requiresAuth, gallery } = resolveManageAccess(profiles, username);
    if (!requiresAuth) {
      logger.info?.('fitness.fingerprint.access.tofu', { username });
      return { ok: true };
    }
    // The manager is admin-gated on entry; if an admin verified within the session
    // window, that scan authorizes manage ops (enroll-verify / delete) — no second
    // scan. This is what makes deleting a print from the UX work (and not depend on
    // a flaky reader, since delete itself never touches it).
    const adminSession = this.#identityRelay?.adminVerifiedWithin?.();
    if (adminSession) {
      logger.info?.('fitness.fingerprint.access.admin-session', { username, by: adminSession.userId });
      return { ok: true };
    }
    const unlockService = this.#resolveUnlockService?.();
    if (!unlockService) return { ok: false, status: 503, body: { error: 'unlock-service-unavailable' } };
    logger.info?.('fitness.fingerprint.access.requires-auth', { username, candidates: gallery.length });
    let verdict;
    try {
      verdict = await unlockService.requestUnlock(`manage:${username}`, gallery);
    } catch (err) {
      logger.error?.('fitness.fingerprint.access.error', { username, error: err?.message });
      return { ok: false, status: 500, body: { error: 'auth-failed' } };
    }
    if (!verdict?.matched) {
      logger.info?.('fitness.fingerprint.access.denied', { username });
      return { ok: false, status: 403, body: { error: 'auth-denied' } };
    }
    logger.info?.('fitness.fingerprint.access.granted', { username, by: verdict.userId });
    return { ok: true };
  }

  /**
   * Enroll a new fingerprint for `username`.
   * Eligibility (admins+primary) is enforced first, then a duplicate-finger guard,
   * then the self/admin gate (TOFU for an unenrolled user). On success the garage
   * box returns a uuid which we persist to the user's profile.yml.
   *
   * @returns {Promise<{ status:number, body:object }>}
   */
  async enroll(householdId, { username, finger, clientToken } = {}) {
    const logger = this.#logger;
    const profile = username ? this.#userService?.getProfile?.(username) : null;
    if (!profile) return { status: 400, body: { error: 'unknown-user' } };
    if (!this.eligibleUsernames(householdId).includes(username)) {
      logger.info?.('fitness.fingerprint.enroll.not-eligible', { username });
      return { status: 403, body: { error: 'not-eligible' } };
    }
    if (!finger || typeof finger !== 'string') {
      return { status: 400, body: { error: 'missing-finger' } };
    }
    const taken = (profile.identities?.fingerprints || []).some((f) => f.finger === finger && !f.simulated);
    if (taken) {
      logger.info?.('fitness.fingerprint.enroll.finger-taken', { username, finger });
      return { status: 409, body: { error: 'finger-taken' } };
    }

    const gate = await this.gate(householdId, username);
    if (!gate.ok) return { status: gate.status, body: gate.body };

    const manageService = this.#resolveManageService?.();
    if (!manageService) return { status: 503, body: { error: 'manage-service-unavailable' } };

    let result;
    try {
      // Stable domain-error contract — the frontend EnrollModal parses the
      // 'enroll-failed' code (overheat/busy hinting), so both the exception path
      // and the !success path below return it rather than a generic 500.
      result = await manageService.requestEnroll({ finger, username, clientToken });
    } catch (err) {
      logger.error?.('fitness.fingerprint.enroll.error', { username, error: err?.message });
      return { status: 500, body: { error: 'enroll-failed' } };
    }
    // The finger already belongs to someone — refuse to file it under another
    // identity. Name the existing owner so the UI can say who.
    if (result?.error === 'duplicate') {
      const owner = buildFingerprintIdentityIndex(this.#userService?.getAllProfiles?.() || {})[result.matchedUuid]?.userId || null;
      const registeredTo = (owner && this.#userService?.getProfile?.(owner)?.display_name) || owner || 'another user';
      logger.warn?.('fitness.fingerprint.enroll.duplicate', { username, finger, matchedUuid: result.matchedUuid, owner });
      return { status: 409, body: { error: 'duplicate-finger', registeredTo } };
    }
    if (!result?.success || !result.uuid) {
      logger.warn?.('fitness.fingerprint.enroll.unsuccessful', { username, reason: result?.error });
      return { status: 500, body: { error: 'enroll-failed', reason: result?.error } };
    }

    const enrolled = new Date().toISOString().slice(0, 10);
    await this.#fingerprintProfileWriter?.addFingerprint(username, { id: result.uuid, finger, enrolled });
    logger.info?.('fitness.fingerprint.enroll.saved', { username, finger });
    return { status: 200, body: { success: true, finger } };
  }

  /**
   * Delete a fingerprint (keyed by finger name; uuids never reach the browser).
   * Requires a self/admin scan, deletes the on-box template, then removes the
   * profile.yml entry (only after the box confirms, to avoid a dangling entry).
   *
   * @returns {Promise<{ status:number, body:object }>}
   */
  async remove(householdId, { username, finger } = {}) {
    const logger = this.#logger;
    const profile = username ? this.#userService?.getProfile?.(username) : null;
    if (!profile) return { status: 400, body: { error: 'unknown-user' } };
    if (!this.eligibleUsernames(householdId).includes(username)) {
      return { status: 403, body: { error: 'not-eligible' } };
    }
    // Simulated fixtures have no on-box template and never collide with a real
    // finger of the same name, so they're excluded from delete matching.
    const matches = (profile.identities?.fingerprints || []).filter((f) => f.finger === finger && !f.simulated);
    if (!finger || matches.length === 0) return { status: 400, body: { error: 'unknown-fingerprint' } };
    if (matches.length > 1) return { status: 409, body: { error: 'ambiguous-finger' } };
    const uuid = matches[0].id;

    const gate = await this.gate(householdId, username);
    if (!gate.ok) return { status: gate.status, body: gate.body };

    const manageService = this.#resolveManageService?.();
    if (!manageService) return { status: 503, body: { error: 'manage-service-unavailable' } };

    let result;
    try {
      // Stable domain-error contract mirroring enroll — 'delete-failed' is the
      // code the fingerprint-manager UI expects.
      result = await manageService.requestDelete({ uuid });
    } catch (err) {
      logger.error?.('fitness.fingerprint.delete.error', { username, error: err?.message });
      return { status: 500, body: { error: 'delete-failed' } };
    }
    if (!result?.success) return { status: 500, body: { error: 'delete-failed', reason: result?.error } };

    await this.#fingerprintProfileWriter?.removeFingerprint(username, uuid);
    logger.info?.('fitness.fingerprint.delete.saved', { username, finger });
    return { status: 200, body: { success: true } };
  }
}

export default ManageAccess;
