/**
 * GetHouseholdCalendar — what the teacher console's Days off panel loads:
 * the breaks as written in `school.yml`, the keep-lists (configured and
 * effective), the activity text of every date-bound unit a break names, and
 * the file revision a save must carry.
 */
import { DAY_OFF_TIERS } from "../../domain/schoolCalendar.mjs";
import { readDayOffPolicy } from "../../domain/dayOffPolicy.mjs";
import { SUBJECT_IDS } from "../../domain/curriculum/unitValidation.mjs";
import { studyDayForInstant } from "../../domain/studyDay.mjs";

export class GetHouseholdCalendar {
  #store; #activities; #curriculum; #programIds; #timezone; #clock;

  constructor({ store, activities, curriculum = null, programIds = () => [], timezone = null, clock = () => new Date() } = {}) {
    if (!store || !activities) throw new Error('GetHouseholdCalendar requires store and activities');
    this.#store = store; this.#activities = activities; this.#curriculum = curriculum; this.#programIds = programIds;
    this.#timezone = timezone; this.#clock = clock;
  }

  async execute() {
    const { revision, config } = this.#store.read();
    const calendar = config?.calendar ?? {};
    const except = Array.isArray(calendar.except) ? calendar.except : [];
    const activities = {};
    for (const span of except) {
      if (!span?.assignment || activities[span.assignment]) continue;
      const found = this.#activities.read(span.assignment);
      activities[span.assignment] = found
        ? {
          unitId: span.assignment, subject: found.subject, title: found.raw?.title ?? '',
          instructions: found.raw?.description ?? '', placeholder: found.raw?.placeholder === true, editable: true,
        }
        // Not on a holiday shelf: authored in a course (read-only here), or
        // not written yet (the panel creates it on save).
        // eslint-disable-next-line no-await-in-loop
        : (await this.#curriculum?.getUnit?.(span.assignment).catch(() => null))
          ? { unitId: span.assignment, editable: false, inCurriculum: true }
          : { unitId: span.assignment, title: '', instructions: '', placeholder: true, editable: true, missing: true };
    }
    return {
      revision,
      today: studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone }),
      except,
      also: Array.isArray(calendar.also) ? calendar.also : [],
      dayOffTiers: config?.dayOffTiers ?? null,
      effectivePolicy: readDayOffPolicy(config?.dayOffTiers ?? undefined).policy,
      tiers: DAY_OFF_TIERS,
      subjects: SUBJECT_IDS,
      programs: [...new Set(this.#programIds() ?? [])].sort(),
      activities,
    };
  }
}

export default GetHouseholdCalendar;
