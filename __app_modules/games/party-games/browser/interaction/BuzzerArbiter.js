// Pure first-buzz-wins arbitration + press-to-bind. No React, no I/O —
// fed by useBuzzers (WS events / fallback keys) and unit-tested directly.

export class BuzzerArbiter {
  constructor(teams = []) {
    this._slotToTeam = {};
    for (const t of teams) {
      if (t.slot) this._slotToTeam[t.slot] = t.id;
    }
    this._armed = new Set();
    this._windowKey = null;
    this.lockedTeamId = null;
    this._bindingTeamId = null;
  }

  arm(teamIds = [], {windowKey} = {}) {
    const unchanged = windowKey !== undefined && windowKey === this._windowKey;
    this._armed = new Set(teamIds);
    this._windowKey = windowKey ?? null;
    if (!unchanged) this.lockedTeamId = null;
  }

  get windowKey() { return this._windowKey; }

  disarm() {
    this._windowKey = null;
    this._armed = new Set();
    this.lockedTeamId = null;
  }

  tryBuzz(slot) {
    if (!this._armed.size) return {accepted:false,reason:'closed'};
    const teamId = this._slotToTeam[slot];
    if (!teamId) return {accepted:false,reason:'unassigned'};
    if (!this._armed.has(teamId)) return {accepted:false,teamId,reason:'ineligible'};
    if (this.lockedTeamId) return {accepted:false,teamId,reason:'already-selected'};
    this.lockedTeamId = teamId;
    return {accepted:true,teamId,reason:'candidate'};
  }

  handleBuzz(slot) {
    const result=this.tryBuzz(slot);
    return result.accepted ? result.teamId : null;
  }

  startBind(teamId) { this._bindingTeamId = teamId; }
  get bindingTeamId() { return this._bindingTeamId; }

  handleBindPress(slot) {
    if (!this._bindingTeamId) return false;
    if (this._slotToTeam[slot] && this._slotToTeam[slot] !== this._bindingTeamId) return false;
    // one slot per team: drop the team's previous binding
    for (const [s, t] of Object.entries(this._slotToTeam)) {
      if (t === this._bindingTeamId) delete this._slotToTeam[s];
    }
    this._slotToTeam[slot] = this._bindingTeamId;
    this._bindingTeamId = null;
    return true;
  }

  bindings() { return { ...this._slotToTeam }; }
  snapshot() { return { slotToTeam: { ...this._slotToTeam } }; }
  restore(snap) { if (snap?.slotToTeam) this._slotToTeam = { ...snap.slotToTeam }; }
}
