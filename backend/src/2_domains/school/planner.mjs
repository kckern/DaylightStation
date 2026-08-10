/**
 * Planner policy (spec §6.3). Pure: no I/O, no clock — `now` is injected and is
 * only ever stamped, never read for a decision.
 *
 * One question: given this learner, this published catalog, this session
 * history and this moment, WHAT IS THERE TO DO? The answer is a flat list of
 * entries, each carrying its own status, and the whole thing renders as the
 * agenda a child holds in their hand.
 *
 * Two rules shape everything below, and both come from that piece of paper:
 *
 *   1. **A lock always names its remedy.** "Locked" on its own is a dead end at
 *      exactly the moment a child needs a next move. Every locked entry carries
 *      the NEAREST blocking unit — its id, its title, and whether it is waiting
 *      to be started or resumed — so the agenda can print "Finish Unit Two
 *      first" instead of a padlock.
 *   2. **Only sequential courses gate.** A unit with a `courseId` sits in an
 *      order somebody authored; a standalone unit does not, so nothing can hold
 *      it back. This is the same rule the materials framework already follows
 *      (`./materialPolicy.mjs`), stated once more over curriculum units.
 *
 * The planner is deliberately ignorant of tokens, printers and sessions-as-
 * storage. It reads DERIVED session facts (`{ unitId, state, terminal, outcome }`,
 * the shape `reduceSession` produces) and returns plain data.
 */

/** Closed set — a status a caller cannot render is a status that cannot exist. */
export const PLAN_STATUSES = Object.freeze(['completed', 'in_progress', 'locked', 'available']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Assignment entries are tolerant on the way in: a parent-edited YAML file may
 * hold `- math-fractions` or `- unitId: math-fractions.02` or
 * `- {unitId: art.01, elective: true}`, and all three mean something obvious.
 */
function readAssignmentList(raw, key) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (isNonEmptyString(entry)) return { id: entry.trim(), elective: false };
      if (isPlainObject(entry) && isNonEmptyString(entry[key])) {
        return { id: entry[key].trim(), elective: entry.elective === true };
      }
      return null;
    })
    .filter(Boolean);
}

/** Course order is the authored sequence; ties break on unitId so it is total. */
function bySequence(a, b) {
  const sa = Number.isInteger(a.sequence) ? a.sequence : Number.MAX_SAFE_INTEGER;
  const sb = Number.isInteger(b.sequence) ? b.sequence : Number.MAX_SAFE_INTEGER;
  return sa - sb || String(a.unitId).localeCompare(String(b.unitId));
}

/**
 * @param {object}  args
 * @param {string}  args.learnerId
 * @param {object}  args.assignment  parent-written `{ courses: [], units: [] }`
 * @param {Array}   args.units       normalised, publishable units (`validateUnit().unit`)
 * @param {Array}   args.sessions    derived session facts for THIS learner:
 *   `{ sessionId, unitId, state, terminal, outcome, updatedAt }`
 * @param {string}  args.now         ISO time; stamped as `generatedAt`, never read for policy
 * @returns {{
 *   learnerId: string|null, generatedAt: string|null, entries: object[],
 *   assigned: object[], available: object[], locked: object[],
 *   inProgress: object[], completed: object[], next: object|null, errors: string[],
 * }}
 */
export function planLearnerWork({ learnerId = null, assignment = null, units = [], sessions = [], now = null } = {}) {
  const errors = [];
  const catalog = (Array.isArray(units) ? units : []).filter((u) => isPlainObject(u) && isNonEmptyString(u.unitId));
  const byUnitId = new Map(catalog.map((u) => [u.unitId, u]));

  // --- what is assigned ----------------------------------------------------
  const assignedCourses = readAssignmentList(assignment?.courses, 'courseId');
  const assignedUnits = readAssignmentList(assignment?.units, 'unitId');

  /** unitId → elective flag, in the order the agenda should offer them. */
  const wanted = new Map();
  assignedCourses.forEach(({ id, elective }) => {
    const members = catalog.filter((u) => u.courseId === id).sort(bySequence);
    if (!members.length) {
      errors.push(`${id}: assigned but no published units belong to it`);
      return;
    }
    members.forEach((u) => { if (!wanted.has(u.unitId)) wanted.set(u.unitId, elective); });
  });
  assignedUnits.forEach(({ id, elective }) => {
    if (!byUnitId.has(id)) { errors.push(`${id}: assigned but not in the published catalog`); return; }
    // An explicit entry never DEMOTES a course unit to elective: the course
    // assignment is the stronger statement and was made first.
    if (!wanted.has(id)) wanted.set(id, elective);
  });

  // --- what the session history says ---------------------------------------
  const history = (Array.isArray(sessions) ? sessions : []).filter(isPlainObject);
  const passedUnits = new Set(
    history.filter((s) => s.outcome?.result === 'passed' && isNonEmptyString(s.unitId)).map((s) => s.unitId),
  );
  /** Most recently updated non-terminal session per unit — the work in hand. */
  const openByUnit = new Map();
  history
    .filter((s) => !s.terminal && isNonEmptyString(s.unitId) && isNonEmptyString(s.sessionId))
    .forEach((s) => {
      const held = openByUnit.get(s.unitId);
      if (!held || String(s.updatedAt ?? '') >= String(held.updatedAt ?? '')) openByUnit.set(s.unitId, s);
    });

  // --- gating --------------------------------------------------------------
  // Computed over the whole COURSE, not over what was assigned: a sequence is a
  // property of the curriculum, so assigning unit 2 alone cannot smuggle a
  // child past unit 1.
  const courseMembers = new Map();
  catalog.forEach((u) => {
    if (!isNonEmptyString(u.courseId)) return;
    if (!courseMembers.has(u.courseId)) courseMembers.set(u.courseId, []);
    courseMembers.get(u.courseId).push(u);
  });
  courseMembers.forEach((list) => list.sort(bySequence));

  /** The nearest earlier unit in this unit's course that has not been passed. */
  const blockerFor = (unit) => {
    const siblings = courseMembers.get(unit.courseId) || [];
    const index = siblings.findIndex((u) => u.unitId === unit.unitId);
    if (index <= 0) return null;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (!passedUnits.has(siblings[i].unitId)) return siblings[i];
    }
    return null;
  };

  /** The unit a pass here would open up — what the result receipt promises. */
  const unlockedBy = (unit) => {
    const siblings = courseMembers.get(unit.courseId) || [];
    const index = siblings.findIndex((u) => u.unitId === unit.unitId);
    if (index === -1 || index + 1 >= siblings.length) return null;
    return siblings[index + 1].unitId;
  };

  // --- entries -------------------------------------------------------------
  const ordering = [...wanted.entries()].map(([unitId, elective], position) => ({ unitId, elective, position }));
  // Required work first, then electives; within each, course order, then the
  // order the parent wrote them.
  ordering.sort((a, b) => {
    if (a.elective !== b.elective) return a.elective ? 1 : -1;
    const ua = byUnitId.get(a.unitId);
    const ub = byUnitId.get(b.unitId);
    if (ua.courseId && ub.courseId && ua.courseId === ub.courseId) return bySequence(ua, ub);
    return a.position - b.position;
  });

  const entries = ordering.map(({ unitId, elective }) => {
    const unit = byUnitId.get(unitId);
    // Program units never carry an open session — always sessionId: null, state: null
    const open = isNonEmptyString(unit.program) ? null : (openByUnit.get(unitId) ?? null);
    const blocker = blockerFor(unit);

    let status = 'available';
    let lockReason = null;
    let remedy = null;

    // Program units are never locked or completed — always available.
    if (isNonEmptyString(unit.program)) {
      status = 'available';
    } else if (passedUnits.has(unitId)) {
      status = 'completed';
    } else if (open) {
      // Beats the lock deliberately: a child holding a printed sheet must be
      // able to finish it, whatever the sequence says about how they got it.
      status = 'in_progress';
    } else if (blocker) {
      status = 'locked';
      lockReason = `Finish “${blocker.title}” first`;
      remedy = {
        unitId: blocker.unitId,
        title: blocker.title,
        action: openByUnit.has(blocker.unitId) ? 'resume' : 'start',
      };
    }

    return {
      unitId,
      title: unit.title ?? unitId,
      subject: unit.subject ?? null,
      courseId: unit.courseId ?? null,
      sequence: Number.isInteger(unit.sequence) ? unit.sequence : null,
      elective,
      program: unit.program ?? null,
      cadence: unit.cadence ?? null,
      schoolcalc: unit.schoolcalc ? structuredClone(unit.schoolcalc) : undefined,
      status,
      sessionId: open?.sessionId ?? null,
      state: open?.state ?? null,
      lockReason,
      remedy,
      unlocks: unlockedBy(unit),
    };
  });

  const of = (status) => entries.filter((e) => e.status === status);
  const inProgress = of('in_progress');
  const available = of('available');

  return {
    learnerId: isNonEmptyString(learnerId) ? learnerId : null,
    generatedAt: isNonEmptyString(now) ? now : null,
    entries,
    assigned: entries,
    inProgress,
    available,
    locked: of('locked'),
    completed: of('completed'),
    next: inProgress[0] ?? available[0] ?? null,
    errors,
  };
}

export default planLearnerWork;
