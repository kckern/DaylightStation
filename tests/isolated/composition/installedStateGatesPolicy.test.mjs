// Regression coverage for the deploy-breaking bug found in the whole-branch
// review of kiosk-friction-detection: this branch changed
// INSTALLED_STATE_GATES_POLICY's *content* (added kiosk.friction-score /
// kiosk.friction-ok / kiosk.access) but left `policy_revision: 1`. The
// production household's state-gates store already had an ACTIVE policy
// candidate at revision 1 with a different digest (verified directly
// against data/household/state-gates/current.yml on the prod host), and
// StateGatesEngine.activatePolicyGraph refuses any candidate whose digest
// differs unless policyRevision strictly increases — a same-or-lower
// revision throws POLICY_REVISION_CONFLICT and SILENTLY keeps the old
// graph. Deployed as-is, the new claim type/gate/entitlement would never
// exist at runtime.
//
// This test exercises the real INSTALLED_STATE_GATES_POLICY object (not a
// hand-rolled fixture policy) through the real YamlStateGatesPolicySource
// normalizer/digester, wired into a real StateGatesContainer, so it fails
// loudly the next time someone edits this policy's content without bumping
// policy_revision.
import { describe, it, expect } from 'vitest';
import { StateGatesContainer } from '#apps/state-gates/StateGatesContainer.mjs';
import { YamlStateGatesPolicySource } from '#adapters/state-gates/index.mjs';
import { INSTALLED_STATE_GATES_POLICY } from '#composition/modules/installedStateGatesPolicy.mjs';

// A minimal in-memory StateGatesContainer harness, mirroring the fixture in
// tests/isolated/application/state-gates/StateGatesContainer.test.mjs, but
// parameterized on an arbitrary policy loader instead of a fixed candidate.
function containerFixture(loadCandidate) {
  let snapshot = null;
  const journal = [];
  const projectionRepository = {
    load: async () => snapshot,
    commitRevision: async (_hid, expected, next, events) => {
      if ((snapshot?.householdRevision ?? 0) !== expected) return { committed: false };
      snapshot = next;
      journal.push(...events.map(event => ({ ...event, published: false })));
      return { committed: true };
    },
  };
  const transitionRepository = {
    pending: async () => journal.filter(item => !item.published),
    markPublished: async (_hid, ids) => journal.forEach(item => { if (ids.includes(item.transitionId)) item.published = true; }),
    replayAfter: async (_hid, revision) => ({ events: journal.filter(item => item.householdRevision > revision) }),
    oldestAvailableRevision: async () => 1,
    compactThrough: async () => {},
  };
  return new StateGatesContainer({
    policySource: { loadCandidate },
    projectionRepository,
    transitionRepository,
    eventPublisher: { publish: async () => {} },
    administrationAuthorizer: { authorize: async () => ({ allowed: true }) },
    loadSubjects: async () => [],
    publisherIds: async () => ['school', 'fitness', 'kiosk-friction-tracker'],
    now: () => Date.parse('2026-09-21T12:00:00Z'),
    timezone: () => 'UTC',
  });
}

// A policy "source" whose raw YAML-shaped object can be swapped mid-test,
// so we can simulate "the store already holds a different digest at the
// same revision" without standing up a second store.
function swappableInstalledPolicySource() {
  let raw = INSTALLED_STATE_GATES_POLICY;
  const adapter = new YamlStateGatesPolicySource({ load: async () => raw });
  return {
    loadCandidate: id => adapter.loadCandidate(id),
    setRaw: next => { raw = next; },
  };
}

describe('installed State Gates policy — activation upgrade path', () => {
  it('activates cleanly into a fresh empty store (the current shipped content + revision)', async () => {
    const policySource = swappableInstalledPolicySource();
    const container = containerFixture(id => policySource.loadCandidate(id));
    const result = await container.activatePolicyGraph('home');
    expect(result).toMatchObject({ result: 'activated', policyRevision: INSTALLED_STATE_GATES_POLICY.policy_revision });
  });

  it('rejects a content change at the SAME policy_revision, and accepts the same change once policy_revision is bumped', async () => {
    const policySource = swappableInstalledPolicySource();
    const container = containerFixture(id => policySource.loadCandidate(id));

    // First activation into a fresh store — this is what production already
    // has active (a real policy_revision:1 candidate was confirmed live in
    // data/household/state-gates/current.yml before this fix).
    const first = await container.activatePolicyGraph('home');
    expect(first.result).toBe('activated');

    // Reproduce the exact mistake this branch shipped: policy CONTENT
    // changes (a new claim type is added, changing the digest) but
    // policy_revision is left untouched.
    const sameRevisionMutation = structuredClone(INSTALLED_STATE_GATES_POLICY);
    sameRevisionMutation.claim_types['kiosk.friction-score-v2'] =
      structuredClone(sameRevisionMutation.claim_types['kiosk.friction-score']);
    policySource.setRaw(sameRevisionMutation);

    await expect(container.activatePolicyGraph('home')).rejects.toMatchObject({ code: 'POLICY_REVISION_CONFLICT' });

    // The store must still be serving the OLD graph — this is the live
    // symptom of the bug class: the new claim type stays invisible at
    // runtime, silently, forever.
    const stillOld = await container.getDiagnostics('home', { id: 'test-admin' });
    expect(stillOld.policy.active).toMatchObject({
      digest: first.digest,
      policyRevision: INSTALLED_STATE_GATES_POLICY.policy_revision,
    });

    // Bumping policy_revision alongside the content change is the actual
    // fix, and the mechanism must accept a real upgrade.
    sameRevisionMutation.policy_revision = INSTALLED_STATE_GATES_POLICY.policy_revision + 1;
    policySource.setRaw(sameRevisionMutation);
    const upgraded = await container.activatePolicyGraph('home');
    expect(upgraded).toMatchObject({
      result: 'activated',
      policyRevision: INSTALLED_STATE_GATES_POLICY.policy_revision + 1,
    });
    expect(upgraded.digest).not.toBe(first.digest);
  });
});
