/**
 * GATE_ID — the shared vocabulary of gate ids.
 *
 * The point of this file is DRIFT, not correctness in the small. A gate id is
 * written by one module and read by another that never imports it (the fitness
 * producer at `FitnessPlayer.jsx`'s `resolvePause` call, the consumer twelve
 * lines below it), so a typo on either side is invisible to every type checker
 * and to every unit test that exercises only one side. The source-text
 * assertions below are the only thing that can see both.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { GATE_ID } from './gateIds.js';
import { resolvePause, PAUSE_REASON } from './pauseArbiter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FITNESS_PLAYER = path.resolve(HERE, '../../../modules/Fitness/player/FitnessPlayer.jsx');

/** Comment-stripped source, so a prose mention of an id never satisfies a code assertion. */
const codeOf = (file) => readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');

describe('GATE_ID', () => {
  it('carries the wire values the shipped telemetry already uses', () => {
    // These strings reach the log store via `PauseDecision.gate`. Changing one
    // is a breaking change to every saved query, so they are pinned here.
    expect(GATE_ID.GOVERNANCE).toBe('governance');
    expect(GATE_ID.CHECKPOINT).toBe('checkpoint');
  });

  it('is frozen, so a consumer cannot mutate the vocabulary at runtime', () => {
    expect(Object.isFrozen(GATE_ID)).toBe(true);
  });

  it('survives the arbiter round trip — the id a producer sets is the gate a consumer reads', () => {
    const decision = resolvePause({
      gates: [{ blocked: true, id: GATE_ID.GOVERNANCE, seekCeiling: null }]
    });
    expect(decision.reason).toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe(GATE_ID.GOVERNANCE);
  });
});

describe('FitnessPlayer uses the shared constant on BOTH sides', () => {
  const source = codeOf(FITNESS_PLAYER);

  it('imports GATE_ID', () => {
    expect(source).toMatch(/import\s*\{[^}]*GATE_ID[^}]*\}\s*from\s*'@\/lib\/Player\/gate\/gateIds\.js'/);
  });

  it('produces the verdict with GATE_ID.GOVERNANCE', () => {
    expect(source).toMatch(/id:\s*GATE_ID\.GOVERNANCE/);
  });

  it('consumes the decision with GATE_ID.GOVERNANCE', () => {
    expect(source).toMatch(/pauseDecision\.gate\s*===\s*GATE_ID\.GOVERNANCE/);
  });

  it('leaves no bare gate-id literal on either side', () => {
    expect(source).not.toMatch(/id:\s*'governance'/);
    expect(source).not.toMatch(/===\s*'governance'/);
  });
});
