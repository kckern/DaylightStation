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

import { evaluateDatedModule, evaluateTiming, studyDate, TIMING_PRIORITY } from './timing.mjs';

/** Closed set — a status a caller cannot render is a status that cannot exist. */
export const PLAN_STATUSES = Object.freeze(['completed', 'in_progress', 'locked', 'available', 'upcoming', 'dormant']);

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
      if (isNonEmptyString(entry)) return { id: entry.trim(), elective: false, profile: null, enrollment: null, timing: null };
      if (isPlainObject(entry) && isNonEmptyString(entry[key])) {
        return {
          id: entry[key].trim(), elective: entry.elective === true,
          profile: isNonEmptyString(entry.profile) ? entry.profile : null,
          enrollment: isPlainObject(entry.enrollment) ? entry.enrollment : null,
          // Preserve malformed parent-authored timing so evaluateTiming can
          // fail closed with an explanatory dormant state instead of silently
          // treating it as unrestricted work.
          timing: entry.timing ?? null,
        };
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
export function planLearnerWork({ learnerId = null, assignment = null, units = [], sessions = [], now = null, timezone = null, coursePolicies = {} } = {}) {
  const errors = [];
  const catalog = (Array.isArray(units) ? units : []).filter((u) => isPlainObject(u) && isNonEmptyString(u.unitId));
  const byUnitId = new Map(catalog.map((u) => [u.unitId, u]));

  // --- what is assigned ----------------------------------------------------
  const assignedCourses = readAssignmentList(assignment?.courses, 'courseId');
  const assignedUnits = readAssignmentList(assignment?.units, 'unitId');

  /** unitId → elective flag, in the order the agenda should offer them. */
  const wanted = new Map();
  const enrollmentByCourse = new Map();
  assignedCourses.forEach(({ id, elective, profile, enrollment, timing }) => {
    enrollmentByCourse.set(id, { profile, enrollment, timing });
    const publishedMembers = catalog.filter((u) => u.courseId === id).sort(bySequence);
    if (!publishedMembers.length) {
      errors.push(`${id}: assigned but no published units belong to it`);
      return;
    }
    // An enrollment is a frozen curriculum statement, not merely an ordering
    // hint. In particular, a learner joining a dated course mid-stream omits
    // already-closed modules from lessonOrder; pulling membership back from
    // the whole catalog would resurrect those deliberately unassigned weeks.
    const hasFrozenMembership = isPlainObject(enrollment?.lessonOrder);
    const frozenIds = new Set(
      hasFrozenMembership
        ? Object.values(enrollment.lessonOrder).flatMap((ids) => (Array.isArray(ids) ? ids : []))
          .filter(isNonEmptyString)
        : [],
    );
    if (hasFrozenMembership && Array.isArray(enrollment.optionalModules)) {
      publishedMembers
        .filter((unit) => enrollment.optionalModules.includes(unit.module))
        .forEach((unit) => frozenIds.add(unit.unitId));
    }
    const members = hasFrozenMembership
      ? publishedMembers.filter((unit) => frozenIds.has(unit.unitId))
      : publishedMembers;
    members.forEach((u) => { if (!wanted.has(u.unitId)) wanted.set(u.unitId, elective); });
  });
  const timingByStandaloneUnit = new Map();
  assignedUnits.forEach(({ id, elective, timing }) => {
    if (!byUnitId.has(id)) { errors.push(`${id}: assigned but not in the published catalog`); return; }
    // An explicit entry never DEMOTES a course unit to elective: the course
    // assignment is the stronger statement and was made first.
    if (!wanted.has(id)) wanted.set(id, elective);
    if (timing) timingByStandaloneUnit.set(id, timing);
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
    const policy = coursePolicies?.[unit.courseId];
    const enrollment = enrollmentByCourse.get(unit.courseId)?.enrollment;
    if (policy?.mode === 'dated_modules' && unit.module) {
      const ordered = enrollment?.lessonOrder?.[unit.module]
        ? enrollment.lessonOrder[unit.module].map((id) => byUnitId.get(id)).filter(Boolean)
        : siblings.filter((entry) => entry.module === unit.module).sort(bySequence);
      const at = ordered.findIndex((entry) => entry.unitId === unit.unitId);
      for (let i = at - 1; i >= 0; i -= 1) if (!passedUnits.has(ordered[i].unitId)) return ordered[i];
      return null;
    }
    if (policy?.mode === 'module_blocks' && unit.module) {
      const opening = policy.required_opening_module;
      const passedModule = (moduleId) => siblings.filter((u) => u.module === moduleId)
        .every((u) => passedUnits.has(u.unitId));
      const optionalModule = enrollment?.optionalModules?.includes(unit.module)
        || siblings.some((u) => u.module === unit.module && u.moduleRole === 'optional');
      if (opening && unit.module !== opening && !passedModule(opening)) {
        return siblings.find((u) => u.module === opening && !passedUnits.has(u.unitId)) ?? null;
      }
      // Bonus material unlocks with the opening unit but never participates
      // in the serial chain of required regional blocks.
      if (optionalModule) return null;
      // A shuffled enrollment is still an assigned COURSE order, not a menu
      // of simultaneously available regions.  Every earlier module must be
      // completed before the next one opens; an open session additionally
      // protects the one-active-module rule during a worksheet attempt.
      const moduleOrder = enrollment?.moduleOrder;
      if (Array.isArray(moduleOrder)) {
        const moduleIndex = moduleOrder.indexOf(unit.module);
        for (let i = moduleIndex - 1; i >= 0; i -= 1) {
          if (!passedModule(moduleOrder[i])) {
            return siblings.find((u) => u.module === moduleOrder[i] && !passedUnits.has(u.unitId)) ?? null;
          }
        }
      }
      const activeModule = siblings.find((u) => u.module && !passedModule(u.module)
        && siblings.some((x) => x.module === u.module && openByUnit.has(x.unitId)))?.module ?? null;
      if (policy.one_active_module && activeModule && activeModule !== unit.module) {
        return siblings.find((u) => u.module === activeModule && !passedUnits.has(u.unitId)) ?? null;
      }
      const ordered = enrollment?.lessonOrder?.[unit.module]
        ? enrollment.lessonOrder[unit.module].map((id) => byUnitId.get(id)).filter(Boolean)
        : siblings.filter((u) => u.module === unit.module).sort(bySequence);
      const at = ordered.findIndex((u) => u.unitId === unit.unitId);
      for (let i = at - 1; i >= 0; i -= 1) if (!passedUnits.has(ordered[i].unitId)) return ordered[i];
      return null;
    }
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
    const policy = coursePolicies?.[unit.courseId];
    const enrollment = enrollmentByCourse.get(unit.courseId)?.enrollment;
    if (policy?.mode === 'dated_modules' && unit.module && enrollment) {
      const inModule = enrollment.lessonOrder?.[unit.module]?.map((id) => byUnitId.get(id)).filter(Boolean) ?? [];
      const at = inModule.findIndex((entry) => entry.unitId === unit.unitId);
      return at >= 0 && at + 1 < inModule.length ? inModule[at + 1].unitId : null;
    }
    if (policy?.mode === 'module_blocks' && unit.module && enrollment) {
      const inModule = enrollment.lessonOrder?.[unit.module]
        ?.map((id) => byUnitId.get(id)).filter(Boolean) ?? [];
      const lessonIndex = inModule.findIndex((entry) => entry.unitId === unit.unitId);
      if (lessonIndex >= 0 && lessonIndex + 1 < inModule.length) {
        return inModule[lessonIndex + 1].unitId;
      }
      const moduleIndex = enrollment.moduleOrder?.indexOf(unit.module) ?? -1;
      if (moduleIndex >= 0) {
        for (let i = moduleIndex + 1; i < enrollment.moduleOrder.length; i += 1) {
          const nextId = enrollment.lessonOrder?.[enrollment.moduleOrder[i]]?.[0];
          if (nextId && byUnitId.has(nextId)) return nextId;
        }
      }
      return null;
    }
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

  const today = studyDate(now, timezone) ?? (typeof now === 'string' ? now.slice(0, 10) : null);
  const datedRankByModule = new Map();
  const datedStateByModule = new Map();
  if (today) {
    enrollmentByCourse.forEach(({ enrollment }, courseId) => {
      if (coursePolicies?.[courseId]?.mode !== 'dated_modules') return;
      const schedule = isPlainObject(enrollment?.moduleSchedule) ? enrollment.moduleSchedule : {};
      const closed = [];
      Object.entries(schedule).forEach(([moduleId, window]) => {
        try {
          const decision = evaluateDatedModule(window, { today });
          const key = `${courseId}/${moduleId}`;
          datedStateByModule.set(key, decision.state);
          if (decision.state === 'available') datedRankByModule.set(key, 0);
          if (decision.state === 'catch_up') closed.push({ moduleId, closesOn: window.closesOn });
        } catch {
          errors.push(`${courseId}: module '${moduleId}' has an unusable window`);
        }
      });
      closed.sort((left, right) => right.closesOn.localeCompare(left.closesOn))
        .forEach(({ moduleId }, index) => datedRankByModule.set(`${courseId}/${moduleId}`, index + 1));
    });
  }
  const entries = ordering.map(({ unitId, elective }) => {
    const unit = byUnitId.get(unitId);
    // Program units never carry an open session — always sessionId: null, state: null
    const open = isNonEmptyString(unit.program) ? null : (openByUnit.get(unitId) ?? null);
    const blocker = blockerFor(unit);

    const rawTiming = unit.courseId
      ? enrollmentByCourse.get(unit.courseId)?.timing ?? null
      : timingByStandaloneUnit.get(unitId) ?? null;
    const datedKey = unit.courseId && coursePolicies?.[unit.courseId]?.mode === 'dated_modules' && unit.module
      ? `${unit.courseId}/${unit.module}` : null;
    const datedState = datedKey ? datedStateByModule.get(datedKey) ?? null : null;
    let timingDecision = null;
    let status = 'available';
    let lockReason = null;
    let remedy = null;

    // Program units do not complete through School evidence, but can still be
    // time-gated like any other planned work.
    if (!isNonEmptyString(unit.program) && passedUnits.has(unitId)) {
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
    } else if (datedKey) {
      if (datedState === 'upcoming' || datedState === null) status = 'upcoming';
    } else if (today) {
      timingDecision = evaluateTiming(rawTiming, { today });
      if (timingDecision.state === 'upcoming') status = 'upcoming';
      if (timingDecision.state === 'dormant') status = 'dormant';
    }
    if (open && today && !datedKey) timingDecision = evaluateTiming(rawTiming, { today, inProgress: true });

    return {
      unitId,
      title: unit.title ?? unitId,
      description: unit.description ?? null,
      subject: unit.subject ?? null,
      courseId: unit.courseId ?? null,
      sequence: Number.isInteger(unit.sequence) ? unit.sequence : null,
      module: unit.module ?? null,
      profile: enrollmentByCourse.get(unit.courseId)?.profile ?? null,
      timing: timingDecision?.timing ?? rawTiming,
      timingState: datedKey ? (datedState ?? 'upcoming') : (timingDecision?.state ?? 'available'),
      // A worksheet already in a child's hands always resumes before a newer
      // calendar candidate; its module state remains catch_up for display.
      timingPriority: datedKey ? (open ? TIMING_PRIORITY.in_progress : TIMING_PRIORITY.medium) : (timingDecision?.priority ?? 3),
      timingRank: datedKey ? (datedRankByModule.get(datedKey) ?? Number.MAX_SAFE_INTEGER) : 0,
      timingReasons: datedKey ? [datedState ?? 'not_scheduled'] : (timingDecision?.reasons ?? ['default_priority']),
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
  const positionFor = (entry) => ordering.findIndex((item) => item.unitId === entry.unitId);
  const byEffectivePriority = (left, right) => left.timingPriority - right.timingPriority
    || (left.timingRank ?? 0) - (right.timingRank ?? 0)
    || positionFor(left) - positionFor(right);
  const inProgress = of('in_progress');
  const available = of('available').sort(byEffectivePriority);

  return {
    learnerId: isNonEmptyString(learnerId) ? learnerId : null,
    generatedAt: isNonEmptyString(now) ? now : null,
    entries,
    assigned: entries,
    inProgress,
    available,
    locked: of('locked'),
    completed: of('completed'),
    next: [...inProgress, ...available].sort(byEffectivePriority)[0] ?? null,
    errors,
  };
}

export default planLearnerWork;
