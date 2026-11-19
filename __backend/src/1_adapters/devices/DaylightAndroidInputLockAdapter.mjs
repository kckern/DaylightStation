/** Native Portal actuator used by both shutdown reconciliation and ordered supervision. */
export class DaylightAndroidInputLockAdapter {
  constructor(client) { this.client = client; }

  async setLockdown({locked, lockedUntil = null, commandRevision = null}) {
    if (typeof locked !== 'boolean') throw new TypeError('Boolean locked required');
    if (commandRevision !== null && (!Number.isSafeInteger(commandRevision) || commandRevision < 1)) {
      throw new TypeError('Positive native command revision required');
    }
    const until = locked && lockedUntil !== null ? Date.parse(lockedUntil) : null;
    if (until !== null && !(until > Date.now())) throw new TypeError('Future lockdown deadline required');
    if (!this.client) return {ok:false, skipped:true, code:'CAPABILITY_UNAVAILABLE'};
    const result = await this.client.post('/lockdown/input', {
      locked, lockedUntil:until, ...(commandRevision === null ? {} : {revision:commandRevision}),
    });
    if (!result.ok) throw Object.assign(new Error('Daylight Android input lock unavailable'), {
      code:result.status ? 'NATIVE_LOCKDOWN_REJECTED' : 'CAPABILITY_UNAVAILABLE', contacted:!!result.status,
    });
    const ack = result.data;
    // An unordered shutdown command is accepted by the device only at revision zero.
    if (ack.inputReady !== true || ack.inputLocked !== locked || ack.revision !== (commandRevision ?? 0)) {
      throw Object.assign(new Error('Daylight Android input lock acknowledgement mismatch'), {code:'NATIVE_ACK_MISMATCH',contacted:true});
    }
    return {ok:true, blocked:locked, commandRevision};
  }

  stop(input) { return this.setLockdown({...input, locked:true}); }
  release(input) { return this.setLockdown({...input, locked:false}); }

  async probe() {
    const result = await this.client?.get('/lockdown');
    const state = result?.data?.inputLock;
    if (!result?.ok || state?.inputReady !== true || typeof state.inputLocked !== 'boolean' ||
        !Number.isSafeInteger(state.revision) || state.revision < 0) {
      return {capabilities:[], error:'CAPABILITY_UNAVAILABLE'};
    }
    return {capabilities:['portal-keys'], locked:state.inputLocked, commandRevision:state.revision};
  }
}
