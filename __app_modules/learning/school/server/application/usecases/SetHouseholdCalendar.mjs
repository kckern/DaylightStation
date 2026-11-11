/**
 * SetHouseholdCalendar — the teacher console's gated calendar write.
 *
 * Whole-list edit of `school.yml → calendar.except` and `dayOffTiers`, plus
 * the date-bound activity units that enrichment and major-holiday breaks
 * name. Order, each step refusing with nothing written:
 *
 *   gate (`calendar.edit`) → validate the calendar and keep-lists with the
 *   same validators the boot path uses → the past is locked (no day before
 *   today may change meaning) → a keep-list change waits while yesterday was
 *   that tier → every activity validates as a unit → write units → write
 *   `school.yml` (stale-checked by revision, backed up) → assign new
 *   activities → install the new calendar live.
 *
 * `calendar.also` (makeup days) is not edited here and is carried through.
 */
import { InvalidInputError, StateConflictError } from '#apps/common/errors/SemanticErrors.mjs';
import { validateSchedule, DAY_OFF_TIERS } from "../../domain/schoolCalendar.mjs";
import { readDayOffPolicy, checkDayOffCalendar } from "../../domain/dayOffPolicy.mjs";
import { validateUnit, SUBJECT_IDS } from "../../domain/curriculum/unitValidation.mjs";
import {
  lockedDayChanges, keepListChanges, keepListBlocked, buildCalendarBlock, addDayKeys,
} from "../../domain/calendarEdit.mjs";
import { studyDayForInstant } from "../../domain/studyDay.mjs";

const ACTIVITY_TIERS = ['enrichment', 'major-holiday'];
const text = (value) => (typeof value === 'string' ? value.trim() : '');

export class SetHouseholdCalendar {
  #store; #activities; #assignments; #teacherGate; #liveCalendar; #curriculum; #reloadConfig;
  #timezone; #clock; #logger; #onUpdated;

  constructor({
    store, activities, assignments = null, teacherGate, liveCalendar, curriculum = null,
    reloadConfig = null, timezone = null, clock = () => new Date(), logger = console, onUpdated = null,
  } = {}) {
    if (!store || !activities || !teacherGate || !liveCalendar) {
      throw new Error('SetHouseholdCalendar requires store, activities, teacherGate and liveCalendar');
    }
    this.#store = store; this.#activities = activities; this.#assignments = assignments;
    this.#teacherGate = teacherGate; this.#liveCalendar = liveCalendar; this.#curriculum = curriculum;
    this.#reloadConfig = reloadConfig; this.#onUpdated = onUpdated; this.#timezone = timezone; this.#clock = clock; this.#logger = logger;
  }

  #refuse(ErrorType, code, message, details = {}) {
    this.#logger.warn?.('school.calendar.save-refused', { code, ...details });
    return new ErrorType(message, { code, details });
  }

  /**
   * @param {{except: object[], dayOffTiers: object|null, activities?: object[],
   *   assignTo?: string[], editedBy: string, pin?: string|null, baseRevision: string}} args
   */
  async execute({
    except, dayOffTiers = null, activities = [], assignTo = [], editedBy = null, pin = null, baseRevision,
  } = {}) {
    this.#teacherGate.assert({
      userId: editedBy, pin, action: 'calendar.edit',
      context: { count: Array.isArray(except) ? except.length : 0 },
    });
    if (typeof baseRevision !== 'string' || !baseRevision) {
      throw this.#refuse(InvalidInputError, 'BASE_REVISION_REQUIRED', 'Reload the calendar before saving.');
    }
    const current = this.#store.read();
    if (current.revision !== baseRevision) {
      throw this.#refuse(StateConflictError, 'STALE_SAVE', 'Someone changed the calendar since you opened it — reload and try again.');
    }

    // --- the calendar, judged by the boot path's own validator ---------------
    const also = current.config?.calendar?.also ?? [];
    const rawBlock = buildCalendarBlock({ except: Array.isArray(except) ? except : [], also: Array.isArray(also) ? also : [] });
    if (!Array.isArray(except)) throw this.#refuse(InvalidInputError, 'CALENDAR_INVALID', 'except must be a list');
    const unknownTier = except.find((span) => span && span.tier && !DAY_OFF_TIERS.includes(span.tier));
    const { errors: calendarErrors, schedule } = validateSchedule(rawBlock);
    if (unknownTier || calendarErrors.length) {
      throw this.#refuse(InvalidInputError, 'CALENDAR_INVALID',
        calendarErrors.join('; ') || `unknown tier: ${unknownTier.tier}`, { errors: calendarErrors });
    }
    const missingTier = (schedule?.except ?? []).find((span) => !span.tier);
    if (missingTier) {
      throw this.#refuse(InvalidInputError, 'CALENDAR_INVALID', `"${missingTier.label ?? missingTier.from}" needs a tier`);
    }
    const enrichmentWithoutSubject = (schedule?.except ?? []).find((span) => span.tier === 'enrichment' && !span.replaces);
    if (enrichmentWithoutSubject) {
      throw this.#refuse(InvalidInputError, 'CALENDAR_INVALID',
        `"${enrichmentWithoutSubject.label ?? enrichmentWithoutSubject.from}" is an enrichment day — pick the subject it replaces`);
    }
    const { errors: policyErrors, policy } = readDayOffPolicy(dayOffTiers ?? undefined);
    if (policyErrors.length) {
      throw this.#refuse(InvalidInputError, 'KEEP_LIST_INVALID', policyErrors.join('; '), { errors: policyErrors });
    }

    // --- the past is settled --------------------------------------------------
    const today = studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
    const before = validateSchedule(current.config?.calendar ?? null).schedule;
    const locked = lockedDayChanges({ before, after: schedule, today });
    if (locked.length) {
      throw this.#refuse(StateConflictError, 'PAST_DAYS_LOCKED',
        `Days already judged cannot change: ${locked.join(', ')}. Edit only today and later.`, { days: locked });
    }
    const { policy: beforePolicy } = readDayOffPolicy(current.config?.dayOffTiers ?? undefined);
    const changedTiers = keepListChanges({ beforePolicy, afterPolicy: policy });
    const heldTier = keepListBlocked({ changedTiers, schedule: before, yesterday: addDayKeys(today, -1) });
    if (heldTier) {
      throw this.#refuse(StateConflictError, 'KEEP_LIST_YESTERDAY',
        `Yesterday was a ${heldTier} day and is still being settled — change the ${heldTier} keep-list tomorrow.`, { tier: heldTier });
    }

    // --- activities -----------------------------------------------------------
    const units = await this.#composeActivities(activities, schedule);

    for (const unit of units) this.#activities.write(unit);
    const written = await this.#store.write({
      calendar: rawBlock,
      dayOffTiers: dayOffTiers && Object.keys(dayOffTiers).length ? dayOffTiers : null,
      baseRevision,
      editedBy,
      summary: { breaks: except.length, activities: units.map((u) => u.unitId), keepListsChanged: changedTiers },
    }).catch((error) => {
      if (error?.code !== 'STALE_SAVE') throw error;
      throw this.#refuse(StateConflictError, 'STALE_SAVE', 'Someone changed the calendar since you opened it — reload and try again.');
    });
    // The file is written: install it live FIRST, so nothing after this point
    // can leave disk and the running app disagreeing.
    this.#liveCalendar.replace({ schedule, policy });
    try { this.#onUpdated?.(); } catch (error) {
      this.#logger.warn?.('school.calendar.on-updated-failed', { error: error?.message });
    }
    try { this.#reloadConfig?.(); } catch (error) {
      this.#logger.warn?.('school.calendar.config-reload-failed', { error: error?.message });
    }
    this.#curriculum?.invalidate?.();
    const { assigned, unassigned } = await this.#assign(units.map((u) => u.unitId), assignTo, editedBy);
    this.#logger.info?.('school.calendar.updated', {
      editedBy, breaks: except.length, activities: units.map((u) => u.unitId), assigned, unassigned, keepListsChanged: changedTiers,
    });
    if (this.#curriculum?.listUnits) {
      this.#curriculum.listUnits().then((all) => {
        checkDayOffCalendar({ schedule, units: all }).missingAssignments
          .forEach((missing) => this.#logger.warn?.('school.calendar.assignment-missing', missing));
      }).catch(() => {});
    }
    return {
      revision: written.revision, calendar: rawBlock, dayOffTiers: dayOffTiers ?? null,
      activities: units.map((u) => u.unitId), assigned, unassigned,
    };
  }

  async #composeActivities(activities, schedule) {
    if (!Array.isArray(activities)) throw this.#refuse(InvalidInputError, 'ACTIVITY_INVALID', 'activities must be a list');
    const spans = schedule?.except ?? [];
    const units = [];
    for (const activity of activities) {
      const unitId = text(activity?.unitId);
      const owners = spans.filter((span) => span.assignment === unitId && ACTIVITY_TIERS.includes(span.tier));
      if (!owners.length) {
        throw this.#refuse(InvalidInputError, 'ACTIVITY_INVALID', `activity ${unitId || '(no id)'} is not named by any enrichment or holiday break`);
      }
      const subject = owners[0].tier === 'enrichment' ? owners[0].replaces : 'scripture';
      if (owners.some((span) => (span.tier === 'enrichment' ? span.replaces : 'scripture') !== subject)) {
        throw this.#refuse(InvalidInputError, 'ACTIVITY_INVALID', `activity ${unitId} is named by breaks that swap different subjects`);
      }
      if (!SUBJECT_IDS.includes(subject)) throw this.#refuse(InvalidInputError, 'ACTIVITY_INVALID', `unknown subject: ${subject}`);
      // A unit authored elsewhere (inside a course) is not this panel's to rewrite.
      if (!this.#activities.read(unitId) && await this.#curriculum?.getUnit?.(unitId)) {
        throw this.#refuse(InvalidInputError, 'ACTIVITY_NOT_EDITABLE', `${unitId} is authored in the curriculum, not as a holiday activity; edit it there`);
      }
      const onDays = owners.map((span) => (span.from === span.to ? span.from : { from: span.from, to: span.to }));
      const unit = this.#activities.compose({
        unitId, subject, title: text(activity.title), description: text(activity.instructions) || null, onDays,
      });
      const { errors } = validateUnit(unit);
      if (errors.length) {
        throw this.#refuse(InvalidInputError, 'ACTIVITY_INVALID', `${unitId}: ${errors.join('; ')}`, { errors });
      }
      units.push(unit);
    }
    return units;
  }

  async #assign(unitIds, learnerIds, editedBy) {
    const assigned = []; const unassigned = [];
    if (!this.#assignments || !unitIds.length || !Array.isArray(learnerIds) || !learnerIds.length) return { assigned, unassigned };
    // Appends to each learner's standalone work through the assignment store
    // (its own history row, stamped with this teacher). A failure for one
    // learner is reported, never thrown: the calendar is already saved.
    for (const learnerId of learnerIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const record = await this.#assignments.get(learnerId);
        if (!record) { unassigned.push(learnerId); continue; }
        const missing = unitIds.filter((id) => !(record.units ?? []).includes(id));
        if (!missing.length) continue;
        // eslint-disable-next-line no-await-in-loop
        await this.#assignments.put({
          ...record, units: [...(record.units ?? []), ...missing],
          assignedBy: editedBy, updatedAt: this.#clock().toISOString(),
        });
        assigned.push(learnerId);
      } catch (error) {
        unassigned.push(learnerId);
        this.#logger.warn?.('school.calendar.assign-failed', { learnerId, code: error?.code ?? null, error: error?.message });
      }
    }
    return { assigned, unassigned };
  }
}

export default SetHouseholdCalendar;
