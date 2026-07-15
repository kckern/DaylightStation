// Pure first-buzz-wins arbitration + press-to-bind. No React, no I/O —
// fed by useBuzzers (WS events / fallback keys) and unit-tested directly.

export class BuzzerArbiter {
  constructor(teams = []) {
    this._slotToTeam = {};
    for (const t of teams) {
      if (t.slot) this._slotToTeam[t.slot] = t.id;
    }
    this._armed = new Set();
    this.lockedTeamId = null;
    this._bindingTeamId = null;
  }

  arm(teamIds = []) {
    this._armed = new Set(teamIds);
    this.lockedTeamId = null;
  }

  disarm() {
    this._armed = new Set();
    this.lockedTeamId = null;
  }

  handleBuzz(slot) {
    if (this.lockedTeamId || this._armed.size === 0) return null;
    const teamId = this._slotToTeam[slot];
    if (!teamId || !this._armed.has(teamId)) return null;
    this.lockedTeamId = teamId;
    return teamId;
  }

  startBind(teamId) { this._bindingTeamId = teamId; }
  get bindingTeamId() { return this._bindingTeamId; }

  handleBindPress(slot) {
    if (!this._bindingTeamId) return false;
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
