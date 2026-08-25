// @vitest-environment node
/**
 * The three surfaces that tell a child what is next must name the SAME unit.
 *
 * `BuildAgenda` prints it on paper. `ResolveSubjectNext` answers the scan of
 * that paper. `ResolveAccessCode` answers the six digits printed beside the QR.
 * They are three readings of one question, and until `PlanProjection` they were
 * three hand-copied assemblies of the planner's inputs. On 2026-08-25 12:15 the
 * receipt promised a lesson the panel then refused and a child was stranded
 * mid-lesson; this file is the regression net for that whole family.
 *
 * WHY THE DEPS ARE DELIBERATELY LOPSIDED. All three use cases used to take
 * their OWN `attestations` source and build their own overlay from it. Six
 * wiring sites, one of which forgets a dep, is not a hypothetical — it is
 * precisely the shape of the defect, and the copy is invisible in review
 * because each file looks self-consistent. So the fixture below wires the
 * attestation source into the SHARED `PlanProjection` and gives it to only ONE
 * of the three use cases directly. Before the migration the two that were not
 * handed it plan a different day; afterwards none of them can, because none of
 * them assembles anything.
 *
 * WHY THE WRITES ARE STUBBED. The claim under test is that the three agree at
 * ONE INSTANT. `BuildAgenda` and `ResolveSubjectNext` both open work sessions
 * as a side effect of answering, so running them in sequence against a live
 * repository moves the very state the next one reads and the comparison
 * silently becomes "do they agree about three different moments". The reads are
 * the real shared store (one learner, one history); only `appendEvent` is a
 * no-op — the same read-real/write-stub split composition already uses for the
 * agenda preview.
 */
import { describe, it, expect } from 'vitest';
import { PlanProjection } from './PlanProjection.mjs';
import { CurriculumAccess } from './CurriculumAccess.mjs';
import { BuildAgenda } from './usecases/BuildAgenda.mjs';
import { ResolveSubjectNext } from './usecases/ResolveSubjectNext.mjs';
import { ResolveAccessCode } from './usecases/ResolveAccessCode.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, FakeTokenRegistry,
  fakeClock, seededRng, sequentialIds, silentLogger,
// Relative, not `#testlib/…`: colocated under `backend/src`, so `#` specifiers
// resolve against `backend/package.json`, which defines no `#testlib`.
} from '../../../../tests/_lib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, WORKSHEET_UNIT,
} from '../../../../tests/_lib/school/lifecycleFixtures.mjs';

const LEARNER = 'kid1';
const SUBJECT = 'math';

/**
 * One learner, one set of stores, one attestation. The attestation is the input
 * the recipes disagree about: with the overlay unit 1 reads as passed and the
 * day's work is unit 2; without it unit 1 is still the offer and unit 2 is
 * locked behind it.
 */
function household() {
  const clock = fakeClock();
  const catalog = new FakeCatalog({
    units: rawUnits(), documents: rawDocuments(), manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger,
  });
  const assignments = new FakeAssignmentStore([
    { learnerId: LEARNER, courses: ['math-fractions'] },
  ]);
  const sessions = new FakeSessionRepository();
  const tokens = new FakeTokenRegistry({ now: clock.iso });
  const attestations = {
    list: ({ learnerId } = {}) => (learnerId === LEARNER
      ? [{ id: 'att1', unitId: MEDIA_UNIT, at: '2026-07-27T08:00:00.000Z' }]
      : []),
  };

  // Reads real, writes stubbed — see the header.
  const readOnlySessions = {
    listForLearner: (id) => sessions.listForLearner(id),
    listOpenForLearner: (id) => sessions.listOpenForLearner(id),
    readEvents: (sid) => sessions.readEvents(sid),
    appendEvent: async () => {},
  };

  const planProjection = new PlanProjection({
    curriculum, assignments, sessions, attestations,
    clock: clock.now, logger: silentLogger,
  });

  const buildAgenda = new BuildAgenda({
    curriculum, assignments, sessions: readOnlySessions, tokens,
    // The one site that was also handed the source directly.
    attestations,
    planProjection,
    timezone: null, clock: clock.now, rng: seededRng(7), newSessionId: sequentialIds(),
    selfService: { enabled: true },
    logger: silentLogger,
  });
  const resolveSubjectNext = new ResolveSubjectNext({
    curriculum, assignments, sessions: readOnlySessions,
    planProjection,
    clock: clock.now, newSessionId: sequentialIds('sn_'), logger: silentLogger,
  });
  const resolveAccessCode = new ResolveAccessCode({
    tokens, curriculum, assignments, sessions,
    planProjection,
    clock: clock.now, logger: silentLogger,
  });

  return { buildAgenda, resolveSubjectNext, resolveAccessCode, tokens };
}

describe('surfaces agree on what is next', () => {
  it('BuildAgenda, ResolveSubjectNext and ResolveAccessCode name the same unit', async () => {
    const { buildAgenda, resolveSubjectNext, resolveAccessCode, tokens } = household();

    const agenda = await buildAgenda.execute({ learnerId: LEARNER, learnerName: 'Kid' });
    const agendaNext = agenda.offers.find((offer) => offer.subject === SUBJECT);
    expect(agendaNext, 'the agenda offered no maths at all').toBeTruthy();

    const scanned = await resolveSubjectNext.execute({ learnerId: LEARNER, subject: SUBJECT });
    const subjectNext = scanned.entry ?? scanned.unit ?? null;

    const record = tokens.ofClass('subject_next').find((r) => r.subject?.subject === SUBJECT);
    expect(record?.accessCode, 'no panel code was printed for maths').toBeTruthy();
    const typed = await resolveAccessCode.resolve({ code: record.accessCode });
    const accessCodeNext = typed.resolution?.entry ?? null;

    expect(agendaNext.unitId).toBe(subjectNext?.unitId);
    expect(agendaNext.unitId).toBe(accessCodeNext?.unitId);
    // …and it is the unit the attestation unlocked, not the one it retired.
    expect(agendaNext.unitId).toBe(WORKSHEET_UNIT);
  });
});
