// Renew this long before the current grant runs out, so the next grant is in
// hand before the old one ends. Without the lead the meter paused the video
// on every 5s grant and resumed it when the server answered (2026-10-18..20:
// a child's video was paused ~2.2s of every 5s).
const RENEW_LEAD_MS = 2000;
// Nothing to meter: poll only to keep the view (remaining time) fresh. Every
// observation is a durable write server-side; policy changes still observe at once.
const IDLE_POLL_MS = 60000;

/** Native-media meter. Durable grants are the only source of unattended time. */
export class PlaybackBudgetController {
  constructor({ deviceId, streamId, now, observe, publish, logger, queueResume = work => work() }) {
    Object.assign(this, { deviceId, streamId, now, observe, publish, logger, queueResume });
    this.input = {}; this.sequence = 0; this.grants = []; this.used = 0;
    this.last = now(); this.playing = false; this.manualPause = false;
    this.pending = Promise.resolve(); this.busy = false; this.dirty = false;
    this.retry = null; this.view = null; this.disposed = false; this.holding = false;
    this.nextPoll = 0; this.expectedPauses = 0;
  }
  eligible() { return !!this.input.matching && !this.input.supervised; }
  valid() { return this.grants.length > 0 && this.grants.length === (this.requiredGrants ?? this.grants.length) && this.grants.every(g => this.used < g.ms && this.now() < g.deadline); }
  state() {
    const eligible = this.eligible();
    const valid = this.valid();
    const expired = this.view?.policies?.some(p => p.expired) && !valid;
    return {
      blocked: eligible && !valid && (!this.manualPause || expired || !!this.retry),
      status: !eligible ? (this.input.supervised ? 'supervised' : 'inactive')
        : valid ? 'ready' : this.retry ? 'unavailable' : expired ? 'exhausted' : 'checking',
      remainingMs: Math.min(...(this.view?.policies?.map(p => p.remainingMs) ?? [0]))
        + (valid ? Math.max(0, Math.min(...this.grants.map(g => g.ms)) - this.used) : 0),
      generation: this.view?.generation ?? 0,
    };
  }
  emit() { if (!this.disposed) this.publish(this.state()); }
  account() {
    const now = this.now();
    if (this.playing && this.eligible() && this.input.canPlay && this.grants.length) {
      const end = Math.min(now, ...this.grants.map(g => g.deadline));
      this.used = Math.min(Math.min(...this.grants.map(g => g.ms)), this.used + Math.max(0, end - this.last));
    }
    this.last = now;
  }
  hold() {
    this.holding = true;
    if (this.input.media?.paused === false) this.expectedPauses += 1;
    this.input.media?.pause?.();
    this.holding = false; this.playing = false;
  }
  bind(media) {
    this.unbind?.(); this.expectedPauses = 0;
    if (!media) { this.unbind = null; return; }
    const listen = (name, handler) => { media.addEventListener(name, handler); return () => media.removeEventListener(name, handler); };
    const stops = [
      listen('play', () => {
        if (!this.eligible()) return;
        this.manualPause = false;
        if (!this.valid() || !this.input.canPlay) { this.resume = true; this.hold(); this.request(); }
      }),
      listen('playing', () => {
        if (media.paused || media.seeking || media.readyState < 3) return;
        this.account();
        if (this.eligible() && (!this.valid() || !this.input.canPlay)) { this.resume = true; this.hold(); this.request(); return; }
        this.playing = true; this.last = this.now();
      }),
      ...['waiting', 'seeking', 'pause', 'ended', 'emptied'].map(event => listen(event, () => {
        if (event === 'pause' && this.expectedPauses > 0) { this.expectedPauses -= 1; return; }
        this.account(); this.playing = false;
        if (this.holding) return;
        if (event === 'pause' && this.input.canPlay && this.eligible()) this.manualPause = true;
        if (this.grants.length) this.request(false);
      })),
    ];
    this.unbind = () => stops.forEach(stop => stop());
  }
  update(input) {
    this.account();
    const changed = this.input.contentId !== input.contentId || this.input.media !== input.media;
    const policyChanged = this.input.supervised !== input.supervised || this.input.canPlay !== input.canPlay
      || this.input.matching !== input.matching || JSON.stringify(this.input.participantIds) !== JSON.stringify(input.participantIds);
    const mediaChanged = this.input.media !== input.media;
    this.input = input;
    if (mediaChanged) this.bind(input.media);
    if (changed) { this.manualPause = false; this.resume = true; this.playing = false; }
    if (this.eligible() && (!this.valid() || !input.canPlay)) this.hold();
    if (changed || policyChanged) this.request();
    this.emit();
  }
  remainingGrantMs() {
    if (!this.grants.length) return 0;
    const now = this.now();
    return Math.min(...this.grants.map(g => Math.min(g.ms - this.used, g.deadline - now)));
  }
  // Settle and re-grant without pausing: playback keeps spending the current
  // grant while the request is in flight, and whatever it spends after the
  // settlement snapshot is carried onto the new grant, so no played time goes
  // unmetered. If the old grant runs out first, tick() holds as usual.
  renew() {
    if (this.disposed || this.busy) return;
    return this.request(true, { renew: true });
  }
  request(allowGrant = true, { renew = false } = {}) {
    if (this.disposed && allowGrant) return;
    if (this.busy) { this.dirty = true; return; }
    this.busy = true;
    this.account();
    const wasPlaying = this.playing || this.input.media?.paused === false;
    if (!renew && (this.grants.length || this.eligible())) this.hold();
    if (!renew) this.resume = this.resume || wasPlaying;
    const usedAtRequest = this.used;
    const settlements = this.grants.map(g => ({ id: g.id, localDate: g.localDate, playedMs: Math.min(g.ms, Math.round(this.used)) }));
    const body = this.retry ?? {
      deviceId: this.deviceId, streamId: this.streamId, sequence: ++this.sequence,
      expectedGeneration: this.view?.generation,
      participantIds: this.input.participantIds ?? [], contentId: this.input.contentId ?? null,
      requestGrant: allowGrant && this.eligible() && this.input.canPlay && !this.manualPause,
      settlements,
      // Kept for older API consumers and diagnostics; the server settles once.
      previousGrantId: settlements[0]?.id, previousGrantDate: settlements[0]?.localDate, playedMs: settlements[0]?.playedMs,
    };
    if (!renew) { this.grants = []; this.used = 0; this.emit(); }
    const started = this.now();
    this.pending = Promise.resolve().then(() => this.observe(body)).then(view => {
      this.account();
      const carried = renew ? Math.max(0, this.used - usedAtRequest) : 0;
      this.retry = null; this.view = view; this.requiredGrants = view.policies.length;
      this.grants = view.policies.filter(p => p.grant).map(p => ({ ...p.grant,
        deadline: started + Math.max(0, p.grant.expiresAt - view.serverNow),
      }));
      this.used = this.grants.length ? Math.min(carried, ...this.grants.map(g => g.ms)) : 0;
      if (renew && !this.valid() && this.eligible()) {
        if (this.input.media?.paused === false) this.resume = true;
        this.hold();
      }
      this.last = this.now();
      this.nextPoll = this.now() + (this.eligible() || this.grants.length ? 5000 : IDLE_POLL_MS);
      this.emit();
      this.queueResume(() => this.tryResume());
    }).catch(error => {
      if (renew) {
        // The current grant is untouched and still spendable; try again soon.
        this.nextPoll = this.now() + 2000;
        this.logger?.warn?.('fitness.playback_budget.unavailable', { message: error.message, renew: true });
        this.emit();
        return;
      }
      this.retry = body; this.nextPoll = this.now() + 2000;
      this.logger?.warn?.('fitness.playback_budget.unavailable', { message: error.message });
      this.emit();
    }).finally(() => {
      this.busy = false;
      if (this.dirty && !this.disposed && !this.retry) { this.dirty = false; this.request(); }
    });
    return this.pending;
  }
  tryResume() {
    if (!this.disposed && this.resume && !this.manualPause && this.input.canPlay && (!this.eligible() || this.valid())) {
      this.resume = false;
      this.input.media?.play?.()?.catch?.(() => {});
    }
  }
  tick() {
    if (this.disposed) return;
    this.account();
    if (this.eligible() && !this.valid()) {
      if (this.input.media?.paused === false) this.resume = true;
      this.hold();
    }
    if (!this.busy) {
      if (this.valid() && !this.retry && (this.remainingGrantMs() <= RENEW_LEAD_MS || this.now() >= this.nextPoll)) this.renew();
      else if ((this.grants.length && !this.valid()) || this.now() >= this.nextPoll) this.request();
    }
    this.emit();
  }
  async dispose() {
    this.account(); this.disposed = true; this.unbind?.();
    await this.pending;
    await this.request(false);
  }
}
