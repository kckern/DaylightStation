/**
 * State Gates policy installed with the application.
 *
 * These definitions are the public contracts for integrations that ship in
 * code. A household-authored state-gates/config.yml still takes precedence;
 * this graph makes the installed School/Piano/Fitness wiring usable before a
 * household needs any custom policy.
 */
export const INSTALLED_STATE_GATES_POLICY = Object.freeze({
  schema: 'daylight.state-gates-policy/v1',
  // Bump this on ANY content change to this policy object (a claim type, a
  // gate expression, a reason label, an entitlement — anything that changes
  // the candidate's digest). `activatePolicyGraph` refuses to activate a
  // candidate whose digest differs from what's already active unless
  // policy_revision strictly increases (POLICY_REVISION_CONFLICT) — nothing
  // else in this file enforces that, and a missed bump fails SILENTLY: the
  // engine just keeps serving the old graph forever, so new claim
  // types/gates/entitlements never exist at runtime. See
  // tests/isolated/composition/installedStateGatesPolicy.test.mjs for the
  // regression test covering this exact failure mode.
  policy_revision: 2,
  publishers: {
    school: { description: 'School learner-day completion authority' },
    fitness: { description: 'Fitness weekly movement authority' },
    'kiosk-friction-tracker': { description: 'Per-device unsupervised-input friction score' },
  },
  subject_sets: {},
  claim_types: {
    'school.day.complete': {
      schema_version: 1,
      value: { type: 'boolean' },
      subject_kinds: ['learner'],
      period_kinds: ['interval'],
      accepted_publishers: ['school'],
      visibility: 'subscriber',
      validity: { must_fit_period: true },
    },
    'fitness.weekly.rings': {
      schema_version: 1,
      value: { type: 'number', min: 0, unit: 'rings' },
      subject_kinds: ['learner'],
      period_kinds: ['interval'],
      accepted_publishers: ['fitness'],
      visibility: 'subscriber',
      validity: { must_fit_period: true },
    },
    'kiosk.friction-score': {
      schema_version: 1,
      value: { type: 'number', min: 0 },
      subject_kinds: ['device'],
      period_kinds: ['interval'],
      accepted_publishers: ['kiosk-friction-tracker'],
      visibility: 'administrative',
    },
  },
  gates: {
    'school.day-complete': {
      schema_version: 1,
      subject_kinds: ['learner'],
      period_kinds: ['interval'],
      expression: {
        claim: {
          type: 'school.day.complete', publisher: 'school',
          subject: '$subject', period: '$period',
        },
      },
      reason_labels: {
        CLAIM_FALSE: 'School work remains for this study day.',
        CLAIM_MISSING: 'School has not reported this study day yet.',
      },
    },
    'fitness.weekly-rings': {
      schema_version: 1,
      subject_kinds: ['learner'],
      period_kinds: ['interval'],
      expression: {
        comparison: {
          claim: {
            type: 'fitness.weekly.rings', publisher: 'fitness',
            subject: '$subject', period: '$period',
          },
          op: 'gte',
          value: { amount: 1, unit: 'rings' },
        },
      },
      progress: { basis_node_id: 'fitness.weekly-rings/expression' },
      reason_labels: {
        CLAIM_MISSING: 'Fitness has not reported this week yet.',
        THRESHOLD_NOT_MET: 'No fitness rings have been recorded this week.',
      },
    },
    'kiosk.friction-ok': {
      schema_version: 1,
      subject_kinds: ['device'],
      period_kinds: ['interval'],
      // A bare `comparison` (not `not(comparison(gte)))`) on purpose: the
      // GateEvaluator's `not` node only inverts `state` and passes the
      // child's `reasons` through unchanged. `comparison` only ever emits a
      // reason when ITS OWN raw comparison is unsatisfied, so under
      // not(comparison(gte 5)) the denial case (friction >= 5) has the raw
      // comparison SATISFIED (reasons: []) and `not` forwards that empty
      // array — no reason code, ever, regardless of which key reason_labels
      // uses below. Expressing the gate directly as `friction < threshold`
      // (matching the bare-comparison shape fitness.weekly-rings already
      // uses) makes THRESHOLD_NOT_MET fire on the actual denial.
      expression: {
        comparison: {
          claim: {
            type: 'kiosk.friction-score', publisher: 'kiosk-friction-tracker',
            subject: '$subject', period: '$period',
          },
          op: 'lt',
          // PROVISIONAL threshold — spec §10 open question 1. Retune
          // against real friction-score history; do not treat as final.
          value: 5,
        },
      },
      reason_labels: {
        CLAIM_MISSING: 'No friction has been reported for this device yet.',
        THRESHOLD_NOT_MET: 'This device is in a cooldown.',
      },
    },
  },
  entitlements: {
    'piano.games': { gate: 'school.day-complete', failure_posture: 'fail_closed' },
    'kiosk.access': { gate: 'kiosk.friction-ok', failure_posture: 'fail_open' },
  },
});

export default INSTALLED_STATE_GATES_POLICY;
