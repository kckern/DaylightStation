import { describe, it, expect } from 'vitest';
import { GoalState, GOAL_TRANSITIONS } from "../../../../__app_modules/life/server/domain/value-objects/GoalState.mjs";
import { BeliefState, BELIEF_TRANSITIONS } from "../../../../__app_modules/life/server/domain/value-objects/BeliefState.mjs";
import { AlignmentState } from "../../../../__app_modules/life/server/domain/value-objects/AlignmentState.mjs";
import { EvidenceType } from "../../../../__app_modules/life/server/domain/value-objects/EvidenceType.mjs";
import { CeremonyType } from "../../../../__app_modules/life/server/domain/value-objects/CeremonyType.mjs";
import { CadenceLevel } from "../../../../__app_modules/life/server/domain/value-objects/CadenceLevel.mjs";
import { DependencyType } from "../../../../__app_modules/life/server/domain/value-objects/DependencyType.mjs";
import { LifeEventType } from "../../../../__app_modules/life/server/domain/value-objects/LifeEventType.mjs";
import { LifeEventImpact } from "../../../../__app_modules/life/server/domain/value-objects/LifeEventImpact.mjs";
import { LifeEventDuration } from "../../../../__app_modules/life/server/domain/value-objects/LifeEventDuration.mjs";
import { AttributionBias } from "../../../../__app_modules/life/server/domain/value-objects/AttributionBias.mjs";
import { BiasStatus } from "../../../../__app_modules/life/server/domain/value-objects/BiasStatus.mjs";
import { BeliefOriginType } from "../../../../__app_modules/life/server/domain/value-objects/BeliefOriginType.mjs";
import { ShadowState } from "../../../../__app_modules/life/server/domain/value-objects/ShadowState.mjs";
import { NightmareProximity } from "../../../../__app_modules/life/server/domain/value-objects/NightmareProximity.mjs";

describe('GoalState', () => {
  it('defines all goal states', () => {
    expect(GoalState.DREAM).toBe('dream');
    expect(GoalState.CONSIDERED).toBe('considered');
    expect(GoalState.READY).toBe('ready');
    expect(GoalState.COMMITTED).toBe('committed');
    expect(GoalState.PAUSED).toBe('paused');
    expect(GoalState.ACHIEVED).toBe('achieved');
    expect(GoalState.FAILED).toBe('failed');
    expect(GoalState.ABANDONED).toBe('abandoned');
    expect(GoalState.INVALIDATED).toBe('invalidated');
  });

  it('validates states', () => {
    expect(GoalState.isValid('dream')).toBe(true);
    expect(GoalState.isValid('flying')).toBe(false);
  });

  it('has valid transitions from dream', () => {
    expect(GOAL_TRANSITIONS.dream).toEqual(['considered', 'abandoned', 'invalidated']);
  });

  it('has valid transitions from committed', () => {
    expect(GOAL_TRANSITIONS.committed).toEqual(['achieved', 'failed', 'paused', 'abandoned', 'invalidated']);
  });

  it('terminal states have no transitions', () => {
    expect(GOAL_TRANSITIONS.achieved).toEqual([]);
    expect(GOAL_TRANSITIONS.abandoned).toEqual([]);
    expect(GOAL_TRANSITIONS.invalidated).toEqual([]);
  });

  it('canTransition validates correctly', () => {
    expect(GoalState.canTransition('dream', 'considered')).toBe(true);
    expect(GoalState.canTransition('dream', 'committed')).toBe(false);
    expect(GoalState.canTransition('achieved', 'dream')).toBe(false);
  });

  it('isTerminal identifies terminal states', () => {
    expect(GoalState.isTerminal('achieved')).toBe(true);
    expect(GoalState.isTerminal('abandoned')).toBe(true);
    expect(GoalState.isTerminal('invalidated')).toBe(true);
    expect(GoalState.isTerminal('committed')).toBe(false);
  });
});

describe('BeliefState', () => {
  it('defines all belief states including cascade states', () => {
    expect(BeliefState.HYPOTHESIZED).toBe('hypothesized');
    expect(BeliefState.TESTING).toBe('testing');
    expect(BeliefState.CONFIRMED).toBe('confirmed');
    expect(BeliefState.UNCERTAIN).toBe('uncertain');
    expect(BeliefState.REFUTED).toBe('refuted');
    expect(BeliefState.DORMANT).toBe('dormant');
    expect(BeliefState.QUESTIONING).toBe('questioning');
    expect(BeliefState.REVISED).toBe('revised');
    expect(BeliefState.ABANDONED).toBe('abandoned');
  });

  it('has valid transitions from hypothesized', () => {
    expect(BELIEF_TRANSITIONS.hypothesized).toEqual(['testing', 'dormant']);
  });

  it('cascade state (questioning) can transition to testing, revised, or abandoned', () => {
    expect(BELIEF_TRANSITIONS.questioning).toEqual(['testing', 'revised', 'abandoned']);
  });

  it('abandoned is terminal', () => {
    expect(BELIEF_TRANSITIONS.abandoned).toEqual([]);
  });

  it('canTransition validates correctly', () => {
    expect(BeliefState.canTransition('hypothesized', 'testing')).toBe(true);
    expect(BeliefState.canTransition('confirmed', 'questioning')).toBe(true);
    expect(BeliefState.canTransition('abandoned', 'testing')).toBe(false);
  });
});

describe('Simple enum value objects', () => {
  it('AlignmentState has aligned, drifting, reconsidering', () => {
    expect(AlignmentState.values()).toEqual(['aligned', 'drifting', 'reconsidering']);
    expect(AlignmentState.isValid('drifting')).toBe(true);
  });

  it('EvidenceType has confirmation, disconfirmation, spurious, untested', () => {
    expect(EvidenceType.values()).toEqual(['confirmation', 'disconfirmation', 'spurious', 'untested']);
  });

  it('CeremonyType has all ceremony types', () => {
    expect(CeremonyType.isValid('unit_intention')).toBe(true);
    expect(CeremonyType.isValid('cycle_retro')).toBe(true);
    expect(CeremonyType.isValid('phase_review')).toBe(true);
    expect(CeremonyType.isValid('season_review')).toBe(true);
    expect(CeremonyType.isValid('era_review')).toBe(true);
    expect(CeremonyType.isValid('emergency_retro')).toBe(true);
  });

  it('CadenceLevel has unit, cycle, phase, season, era', () => {
    expect(CadenceLevel.values()).toEqual(['unit', 'cycle', 'phase', 'season', 'era']);
  });

  it('DependencyType has prerequisite, recommended, life_event, resource', () => {
    expect(DependencyType.values()).toEqual(['prerequisite', 'recommended', 'life_event', 'resource']);
  });

  it('LifeEventType has family, career, location, education, health, financial', () => {
    expect(LifeEventType.values()).toEqual(['family', 'career', 'location', 'education', 'health', 'financial']);
  });

  it('LifeEventImpact has blocks, derails, invalidates, transforms, cascades', () => {
    expect(LifeEventImpact.values()).toEqual(['blocks', 'derails', 'invalidates', 'transforms', 'cascades']);
  });

  it('LifeEventDuration has temporary, indefinite, permanent', () => {
    expect(LifeEventDuration.values()).toEqual(['temporary', 'indefinite', 'permanent']);
  });

  it('AttributionBias has all bias types', () => {
    const biases = AttributionBias.values();
    expect(biases).toContain('survivorship');
    expect(biases).toContain('confirmation');
    expect(biases).toContain('small_sample');
    expect(biases).toContain('confounding');
    expect(biases).toContain('luck');
    expect(biases.length).toBe(9);
  });

  it('BiasStatus has acknowledged, dismissed, unexamined', () => {
    expect(BiasStatus.values()).toEqual(['acknowledged', 'dismissed', 'unexamined']);
  });

  it('BeliefOriginType has experience, observation, teaching, culture, reasoning, trauma', () => {
    expect(BeliefOriginType.values()).toEqual(['experience', 'observation', 'teaching', 'culture', 'reasoning', 'trauma']);
  });

  it('ShadowState has dormant, emerging, active', () => {
    expect(ShadowState.values()).toEqual(['dormant', 'emerging', 'active']);
  });

  it('NightmareProximity has distant, approaching, imminent', () => {
    expect(NightmareProximity.values()).toEqual(['distant', 'approaching', 'imminent']);
  });
});
