/**
 * AskSession — the one seam between a HOST and a JUDGED ATTEMPT.
 *
 * A host knows why a child is being asked to play: a game gate knows the match
 * on the other side and the rung the child is standing on; a program step knows
 * which step it finishes; a practice route knows nothing at all, which is also
 * an answer. None of them should have to know how a material spec becomes an
 * instance, which requirement a level implies, or what sentence a child reads.
 * That is this component, and it is the only place any of it lives.
 *
 * What it owns (moved here from `GameGate.serve` and `ExerciseRun.loadInstance`,
 * task 3 of the ask-platform SP1 plan):
 *
 *  - **Material resolution** — a `materialSpec` becomes an instance (or a score
 *    DOCUMENT), through `keysInstance` for a synthesized lit-key ask and
 *    `resolveGateMaterial` for everything else. An `instanceId` with no spec
 *    takes the bank straight.
 *  - **Requirement building** — `requirementForLevel(ask)` when a level was
 *    given; otherwise the host's `requirementOverride`, or the fetched program
 *    step's own.
 *  - **Ask copy** — `askForMaterial(spec, instance)`: the one sentence saying
 *    what to play.
 *  - **Framing** — why this screen exists, in the host's words. A string passes
 *    through; an object goes to `framingFor`; and a program mount with no
 *    framing of its own computes one from the step it already fetched.
 *
 * What it does NOT own, deliberately: the ladder, rotation, substitution
 * policy, and what a failure costs all stay with the host — this component
 * SURFACES reasons and never decides what they mean. Presentation, grading,
 * persistence and evidence all stay below, in `ExerciseRun`, which it mounts.
 *
 * The `onUnavailable` vocabulary is unchanged and frozen: `no-access`,
 * `instance-not-found`, `unrunnable`. `no-access` and a mounted run's own dead
 * ends are still reported by the run below, with one argument. Everything THIS
 * component refuses — material that never resolved, and an ask the schema will
 * not accept — is reported here with a second argument naming the reason, and
 * the run is not mounted on nothing. The invariant a host may rely on is about
 * the ARGUMENT, never about the word: a second argument means the session
 * refused, its absence means a mounted run died. Both `instance-not-found` and
 * `unrunnable` occur on both sides of that line.
 *
 * That second argument is the whole reason a host can still tell a config
 * mistake from an outage. The decline strings (`no-collection-or-instance`,
 * `no-score-source` and `unknown-material-kind` are authored mistakes;
 * `instance-unavailable`, `catalog-unavailable`, `score-unavailable` are
 * outages) are produced by `resolveSpec` and by nothing else, and before this
 * they reached only the log — where `GameGate`'s substitute-don't-grant policy
 * could not read them. They are SURFACED here, never interpreted: which of
 * them is worth a free match is the host's decision and stays there.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import PianoEmpty from '../PianoKiosk/PianoEmpty.jsx';
import ExerciseRun from '../PianoKiosk/modes/Exercises/ExerciseRun.jsx';
import { resolveSpec } from '../PianoKiosk/modes/Games/gateMaterial.js';
import { expandAsk, validateAsk } from './askSchema.js';
import { loadAskSources, PENDING_SOURCES } from './askResolution.js';
import { askForMaterial, framingFor, requirementForLevel } from './gateAsk.js';

/**
 * Which `source` axis value a material spec's KIND names.
 *
 * The schema's source axis and the material vocabulary are two names for one
 * fact, and this is the only place they meet. Supplying it is what lets the
 * constraint table say anything at all about a legacy level: a `tier: 3` level
 * asserts `timing: cued`, and `cued ⇒ a source that can carry note values` can
 * only be checked once the material it was picked with is known.
 */
const SOURCE_KIND = Object.freeze({ keys: 'synthesized', exercise: 'bank', score: 'score' });

/**
 * The flat ask tuple a level plus its picked material actually expresses.
 *
 * Two facts come from the MATERIAL rather than from the level, because the
 * level never states them:
 *
 *  - `source`, above.
 *  - `notationStyle: 'score'` for score material, at every tier. That is not a
 *    liberty: it reproduces the short-circuit the run surface has always run
 *    (`stage = score ? 'score' : stageForTier(...)`) — a document has exactly
 *    one honest stage, and a tier-2 level naming a passage still engraves it.
 *
 * Errors from both halves are concatenated: `expandAsk`'s (an unknown tier, an
 * out-of-vocabulary axis, a not-yet-implemented one) and the constraint table's.
 *
 * @param {object} levelLike A repertoire level, legacy or explicit shaped.
 * @param {object|null} spec The material spec the host picked for it.
 * @returns {{ tuple: object, errors: string[] }}
 */
export function askTupleFor(levelLike, spec) {
  const { presentation, grading, errors } = expandAsk(levelLike);
  const sourceKind = SOURCE_KIND[spec?.kind];
  const tuple = {
    ...presentation,
    judging: grading.judging,
    ...(sourceKind ? { source: { kind: sourceKind } } : {}),
    ...(sourceKind === 'score' ? { notationStyle: 'score' } : {}),
  };
  return { tuple, errors: [...errors, ...validateAsk(tuple).errors] };
}

/**
 * The whole resolution, in the two steps it has always taken — and it is two,
 * not one, because an AUTHORED SPEC and a MATERIAL DESCRIPTOR are different
 * things and only the first of them can name a rotation.
 *
 *  1. `resolveSpec` turns what a level actually wrote — `{collection, roots}`,
 *     `{instanceId}`, `{notes, arrangement}`, `{source, measures}` — into a
 *     descriptor. This is where a lit key is SYNTHESIZED (no bank entry exists
 *     for "press a key", and a network round trip for one would put a 502
 *     between a four-year-old and the easiest thing a gate can ask), and where
 *     `pickIndex` rotates a level's roots so two consecutive gates at
 *     `roots: [G, D, F]` are two different scales rather than the same one
 *     twice.
 *  2. `loadAskSources` loads what that descriptor points at. An exercise
 *     descriptor already carries its instance and short-circuits; a SCORE one
 *     carries only a path, deliberately — the rotation may never have served it,
 *     and a pick that fetched would pull a whole document over the wire to
 *     decide it had one.
 *
 * A spec that cannot resolve is reported on the same event as a material that
 * cannot, with its own exact reason string, and answers "settled with nothing"
 * — reported as `instance-not-found`, exactly the word it has always carried.
 *
 * A REJECTED fetch answers the same way rather than escaping. Nothing above
 * catches it: an unhandled rejection here would leave a child on a skeleton
 * that never lifts, and a host that fails open on an outage — which is the
 * whole point of a gate failing open — would never be told there was one.
 */
async function resolveSession({
  materialSpec, pickIndex, mode, instanceId, programId, stepId, requirementOverride, logger,
}) {
  const sources = { instanceId, programId, stepId, requirementOverride, logger };
  const kind = materialSpec?.kind ?? null;
  try {
    if (!materialSpec) return { ...(await loadAskSources({ material: null, ...sources })), material: null };
    const picked = await resolveSpec(materialSpec, { pickIndex, mode });
    if (!picked.ok) {
      logger?.warn('piano.exercise-material-unresolved', { kind, error: picked.error });
      return {
        instance: null, score: null, requirement: null, step: null, material: null,
        decline: { kind, reason: picked.error },
      };
    }
    return { ...(await loadAskSources({ material: picked.material, ...sources })), material: picked.material };
  } catch (error) {
    // A thrown fetch is the same thing a 502 is: the bank could not answer.
    // It is named with the vocabulary's word for that so a host classifies it
    // identically; the message that only a human can use goes to the log.
    logger?.warn('piano.exercise-material-unresolved', {
      kind, error: 'instance-unavailable', thrown: error?.message ?? String(error),
    });
    return {
      instance: null, score: null, requirement: null, step: null, material: null,
      decline: { kind, reason: 'instance-unavailable' },
    };
  }
}

/**
 * @param {object} props
 * @param {object|null} [props.ask] The LEVEL this run asks — legacy
 *   (`{tier, material, grading}`) or explicit (`{material, presentation,
 *   grading}`). Expanded and validated here; an ask the schema refuses is
 *   `unrunnable` rather than a half-built screen. Memoize it: a fresh object
 *   per render would re-resolve the material under the child's hands.
 * @param {object|null} [props.materialSpec] The AUTHORED spec the host picked
 *   out of the level's material list — `{kind:'exercise', collection, roots}`,
 *   `{kind:'exercise', instanceId}`, `{kind:'keys', notes, arrangement}` or
 *   `{kind:'score', source, measures}` — never a descriptor something already
 *   resolved. It is the single input to BOTH halves of this seam, and that is
 *   deliberate: the copy a child reads is written from what the level asked for
 *   (`notes: 1` is what makes the floor say "Press the lit key"), while the
 *   resolution needs the same shape to know it must rotate roots. Splitting
 *   them into two props would let a host pass one that says "one lit key" and
 *   another that plays three. WHICH spec is the host's decision (the gate
 *   rotates; this component never does) — memoize it, same reason as `ask`.
 * @param {number} [props.pickIndex] The host's rotation counter: which of a
 *   level's roots is served today, and the only source of variation in a
 *   synthesized lit-key ask.
 * @param {string|null} [props.instanceId] A bank instance, for a host with no
 *   spec to pick from (practice, program steps, video checkpoints).
 * @param {string|null} [props.programId] The program a step belongs to. Fetched
 *   for its step: the requirement, and the framing line C1 asked for.
 * @param {string|null} [props.stepId] Which step of it.
 * @param {object|null} [props.requirementOverride] A host-authored requirement,
 *   which wins over the step's. Passed down BY IDENTITY.
 * @param {'practice'|'challenge'} [props.intent]
 * @param {'free'|'metronome'|'cued'} [props.practiceMode]
 * @param {string|{kind:string}|null} [props.framing] Why this screen exists. A
 *   string is the host's own sentence and passes through untouched; an object
 *   is a framing CONTEXT and goes to `framingFor`; `null` alongside a
 *   `programId` computes the program's own line from the fetched step.
 * @param {(result:object)=>void} [props.onPassed]
 * @param {(result:object)=>void} [props.onFailed] Judged attempts only.
 * @param {()=>void} [props.onExit]
 * @param {(settled:{material:object|null, instance:object|null, score:object|null,
 *   requirement:object|null})=>void} [props.onResolved] What this session settled
 *   on, once per resolution. A host that only mounts a screen needs none of it;
 *   a host that LOGS what a child was asked to play, or offers a way to go and
 *   practise the very thing, cannot name it otherwise — the authored spec says
 *   `{collection:'scales', roots:['G','D','F']}` and only the resolution knows
 *   that today that is G major.
 * @param {(reason:'no-access'|'instance-not-found'|'unrunnable',
 *   decline?:{kind:string|null, reason:string, mode:'free'|'cued'})=>void} [props.onUnavailable]
 *   The first argument is the frozen vocabulary and never grows. The second is
 *   present ONLY when this session is the one refusing — material that would
 *   not resolve — and carries the exact decline reason. Its absence is
 *   meaningful: it says the mounted RUN dead-ended, which is a different
 *   situation with a different answer.
 */
export default function AskSession({
  ask = null,
  materialSpec = null,
  pickIndex = 0,
  instanceId = null,
  programId = null,
  stepId = null,
  requirementOverride = null,
  intent = 'practice',
  practiceMode = 'free',
  framing = null,
  onPassed,
  onFailed,
  onExit,
  onResolved,
  onUnavailable,
}) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-ask-session' }), []);
  const [sources, setSources] = useState(PENDING_SOURCES);
  /**
   * The host's callbacks, read at CALL time rather than captured.
   *
   * The resolution reports its answer from a promise continuation, and a host
   * that re-renders in response to the report (which the gate does — it puts
   * the resolved material into its own state) would otherwise be answered
   * through the closure it had before it moved. Holding them here also keeps
   * them out of the resolution effect's dependencies, where a fresh arrow per
   * render would refetch the instance under a child's hands.
   */
  const hostRef = useRef(null);
  hostRef.current = { onResolved, onUnavailable };

  /**
   * A repertoire level IS its requirement — one is derived from the other and
   * there is nothing to fetch. Memoized because the run below rebuilds its
   * attempt when this reference changes, and `requirementForLevel` answers with
   * a fresh object every time it is asked.
   *
   * It is computed BEFORE the resolution because the resolution needs its
   * `mode`: a catalog-addressed collection is walked for material that supports
   * the mode this level will be graded in, and a level whose only cued variants
   * were filtered out is a different answer from one whose bank was down.
   */
  const levelRequirement = useMemo(() => (ask ? requirementForLevel(ask) : null), [ask]);
  const mode = levelRequirement?.mode ?? 'free';
  // Reported back to the host on settle, and read at call time for the same
  // reason the callbacks are: it must not become a resolution dependency.
  const levelRequirementRef = useRef(null);
  levelRequirementRef.current = levelRequirement;

  const askErrors = useMemo(
    () => (ask ? askTupleFor(ask, materialSpec).errors : []),
    [ask, materialSpec],
  );
  /**
   * An ask the schema refuses, reported once per (ask, spec) pair.
   *
   * The SPEC is half the key, not a detail. A host walking a level's material
   * hands down a different spec after each refusal, and two of them can refuse
   * with the identical error list — a level asserting `hints: 'after-stall'`
   * refuses whatever it is paired with. Keyed on the message alone, the second
   * spec's refusal would be swallowed as a repeat, the host would never be told,
   * and a child would sit on "Cannot start this one" with no gate behind it
   * doing anything about it.
   *
   * The decline travels the same way a material decline does, and for the same
   * reason: this is the SESSION refusing an authored ask, which is a config
   * mistake a host can substitute its way out of — not a run that died on real
   * material. Only the host knows which of those is worth a free match.
   */
  const refusedRef = useRef(null);
  useEffect(() => {
    if (!askErrors.length) return;
    const signature = askErrors.join('|');
    if (refusedRef.current?.signature === signature && refusedRef.current?.spec === materialSpec) return;
    refusedRef.current = { signature, spec: materialSpec };
    logger.warn('piano.ask-invalid', { level: ask?.id ?? null, tier: ask?.tier ?? null, errors: askErrors });
    hostRef.current.onUnavailable?.('unrunnable', {
      kind: materialSpec?.kind ?? null, reason: 'ask-invalid', mode,
    });
  }, [ask, askErrors, logger, materialSpec, mode]);

  /**
   * The material, and the program step beside it. Refused asks never reach
   * here: an ask nothing can honour must not also cost a network round trip.
   */
  const refused = askErrors.length > 0;
  useEffect(() => {
    if (refused) return undefined;
    let alive = true;
    setSources(PENDING_SOURCES);
    resolveSession({ materialSpec, pickIndex, mode, instanceId, programId, stepId, requirementOverride, logger })
      .then((next) => {
        if (!alive) return;
        setSources(next);
        const host = hostRef.current;
        // Exactly one report per resolution, on exactly one channel. A decline
        // that ALSO handed the run a settled-with-nothing would be reported
        // twice — once here with its reason, once by the run without it — and
        // a host reading the second would fail open on a config typo.
        if (next.decline) host.onUnavailable?.('instance-not-found', { ...next.decline, mode });
        else {
          host.onResolved?.({
            material: next.material ?? null,
            instance: next.instance ?? null,
            score: next.score ?? null,
            requirement: levelRequirementRef.current ?? next.requirement ?? null,
          });
        }
      });
    return () => { alive = false; };
  }, [instanceId, logger, materialSpec, mode, pickIndex, programId, refused, requirementOverride, stepId]);

  const requirement = levelRequirement ?? sources.requirement;

  const askLine = useMemo(
    () => (materialSpec ? askForMaterial(materialSpec, sources.instance) : null),
    [materialSpec, sources.instance],
  );

  const framingLine = useMemo(() => {
    if (typeof framing === 'string') return framing;
    if (framing && typeof framing === 'object') return framingFor(framing);
    // The program branch, computed from the step this session already fetched.
    // Nothing else in the app had a caller for it, which is why a child passing
    // a program step used to read "Pass challenge" and never learn which one.
    if (framing == null && sources.step) return framingFor({ kind: 'program', stepLabel: sources.step.title });
    return null;
  }, [framing, sources.step]);

  /**
   * A NUMBER, straight off the level, or nothing. Not filtered: the run warns
   * on a tier it cannot use (`piano.exercise-tier-invalid`), and a YAML tier
   * that arrived as a string must still reach that warn rather than be quietly
   * turned into "no tier given".
   */
  const tier = ask ? ask.tier ?? null : null;

  // The same words the run itself uses for the state, because it is the same
  // state: something this screen needs is missing and no retry will find it.
  if (refused) {
    return <PianoEmpty message="Cannot start this one. It is missing something the challenge needs — try another." />;
  }

  // Material that never resolved. The words are the run's own for this state,
  // unchanged, because it IS the same state — what moved is only who says so,
  // and mounting a run on nothing just to have it say it would cost a second
  // report of the same fact with the reason stripped off.
  if (sources.decline) return <PianoEmpty message="Exercise not found. It may have been renamed." />;

  return (
    <ExerciseRun
      intent={intent}
      practiceMode={practiceMode}
      programId={programId}
      stepId={stepId}
      instance={sources.instance}
      score={sources.score}
      requirement={requirement}
      framing={framingLine}
      ask={askLine}
      tier={tier}
      onPassed={onPassed}
      onFailed={onFailed}
      onExit={onExit}
      onUnavailable={onUnavailable}
    />
  );
}
