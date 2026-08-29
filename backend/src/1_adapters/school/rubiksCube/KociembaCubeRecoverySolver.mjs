import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { applySequence, isSolved, normalizeMove } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { faceletsToEngineCube } from '#shared/gaming/rulesets/rubiks-cube/facelets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Bounded worker-backed adapter for a pinned Kociemba two-phase solver. */
export class KociembaCubeRecoverySolver {
  #worker = null; #nextId = 1; #pending = new Map(); #timeoutMs;
  constructor({ timeoutMs = 12_000, workerPath = path.join(HERE, 'kociembaWorker.mjs') } = {}) { this.#timeoutMs = timeoutMs; this.workerPath = workerPath; }
  #ensureWorker() {
    if (this.#worker) return this.#worker;
    this.#worker = new Worker(this.workerPath);
    this.#worker.on('message', (message) => {
      const pending = this.#pending.get(message.id); if (!pending) return;
      this.#pending.delete(message.id); clearTimeout(pending.timer);
      message.ok ? pending.resolve(message.moves) : pending.reject(new Error(message.error));
    });
    this.#worker.on('error', (error) => this.#failAll(error));
    this.#worker.on('exit', (code) => { if (code) this.#failAll(new Error('The recovery solver stopped unexpectedly.')); this.#worker = null; });
    return this.#worker;
  }
  #failAll(error) { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.#pending.clear(); }
  async solve(facelets) {
    if (typeof facelets !== 'string' || facelets.length !== 54 || /[^URFDLB]/.test(facelets)) throw new Error('A valid 54-sticker cube is required.');
    const initial = faceletsToEngineCube(facelets); if (!initial) throw new Error('The entered cube is not valid.');
    const id = this.#nextId++;
    const moves = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error('The recovery solver took too long. Try entering the cube again.')); }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer }); this.#ensureWorker().postMessage({ id, facelets });
    });
    if (!Array.isArray(moves) || moves.some((move) => !normalizeMove(move))) throw new Error('The recovery solver returned an invalid move sequence.');
    if (!isSolved(applySequence(initial, moves))) throw new Error('The recovery solver result did not verify.');
    return moves;
  }
  async close() { await this.#worker?.terminate(); this.#worker = null; }
}
export default KociembaCubeRecoverySolver;
