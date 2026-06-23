// Web Audio engine for Decks. One-shots fire immediately; loop pads launch/stop
// quantized to the bar grid so stacks stay in time. The bar grid is anchored to a
// single `origin` so every loop shares one phase. Buffer durations equal the bar
// length (loops are pre-rendered at the kit BPM), so loop=true keeps them aligned.

/** Bar length in seconds for a tempo. */
export function barDuration(bpm, bars = 1, beatsPerBar = 4) {
  if (!(bpm > 0)) return 0;
  return (60 / bpm) * beatsPerBar * (bars || 1);
}

/**
 * Next bar boundary at/after `now`, given the grid `origin` + `barDur`. Pure +
 * unit-tested. A tiny epsilon avoids re-quantising to a boundary we're already on.
 */
export function nextBoundary(now, origin, barDur) {
  if (!(barDur > 0)) return now;
  const n = Math.max(0, Math.ceil((now - origin) / barDur - 1e-6));
  return origin + n * barDur;
}

export class DecksEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = new Map(); // id -> AudioBuffer
    this.loops = new Map();   // id -> AudioBufferSourceNode
    this.origin = 0;
    this.barDur = barDuration(120);
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.origin = this.ctx.currentTime;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setTempo(bpm, bars = 1) { this.barDur = barDuration(bpm, bars); }

  /** Fetch + decode every sample in the kit. `fileUrl(relPath)` → absolute URL. */
  async loadKit(kit, fileUrl) {
    const ctx = this._ensure();
    this.setTempo(kit.bpm || 120, kit.bars || 1);
    this.stopAll();
    this.buffers.clear();
    const samples = [...(kit.loops || []), ...(kit.oneshots || [])];
    await Promise.all(samples.map(async (s) => {
      const res = await fetch(fileUrl(s.file));
      if (!res.ok) throw new Error(`fetch ${s.file}: ${res.status}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(s.id, buf);
    }));
    return [...this.buffers.keys()];
  }

  playOneShot(id, gain = 1) {
    const ctx = this._ensure();
    const buf = this.buffers.get(id);
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  isLooping(id) { return this.loops.has(id); }

  startLoop(id) {
    const ctx = this._ensure();
    const buf = this.buffers.get(id);
    if (!buf || this.loops.has(id)) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.master);
    src.start(nextBoundary(ctx.currentTime, this.origin, this.barDur));
    this.loops.set(id, src);
    return true;
  }

  stopLoop(id) {
    const src = this.loops.get(id);
    if (!src) return false;
    try { src.stop(nextBoundary(this.ctx.currentTime, this.origin, this.barDur)); } catch { /* already stopped */ }
    this.loops.delete(id);
    return true;
  }

  toggleLoop(id) { return this.loops.has(id) ? (this.stopLoop(id), false) : (this.startLoop(id), true); }

  stopAll() { for (const id of [...this.loops.keys()]) this.stopLoop(id); }

  dispose() {
    this.stopAll();
    try { this.ctx?.close?.(); } catch { /* ignore */ }
    this.ctx = null;
    this.buffers.clear();
  }
}

export default DecksEngine;
