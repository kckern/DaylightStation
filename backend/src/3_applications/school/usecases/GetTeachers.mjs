/**
 * GetTeachers — the config-declared teacher roster for the teacher console's
 * picker (spec §4.7.1). Teacher is a ROLE (school.yml `teachers:` list of
 * roster ids), not an age — but every id must still resolve to a
 * GrownUpGate-passing roster member, so a child listed as teacher is dropped,
 * not empowered.
 *
 * Resolution happens AT REQUEST TIME, never at boot: the roster changes after
 * composition (GrownUpGate's own documented rule), and a bad entry must cost a
 * picker entry plus a loud log line — never the container (the generated-banks
 * boot crash-loop is the precedent not to repeat). Shape violations
 * (non-strings, empties, duplicates) are likewise dropped-and-warned.
 *
 * `configured` distinguishes "no `teachers:` key at all" from "configured but
 * nothing resolved" so the client can say which is wrong. Only `{id, name}`
 * ever leaves — birthyear and the rest of the profile stay server-side.
 */
import { isAdult } from '#domains/school/index.mjs';

export class GetTeachers {
  #teachers; #roster; #clock; #logger;

  /**
   * @param {object} deps
   * @param {() => (Array<string>|undefined)} deps.teachers - the configured id
   *   list; undefined = the `teachers:` key is absent entirely
   * @param {() => Array<{id: string, name?: string, birthyear?: number}>} deps.roster
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ teachers, roster, clock = () => new Date(), logger = console } = {}) {
    if (typeof teachers !== 'function') throw new Error('GetTeachers requires a teachers config accessor');
    if (typeof roster !== 'function') throw new Error('GetTeachers requires a roster accessor');
    this.#teachers = teachers;
    this.#roster = roster;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** @returns {Promise<{configured: boolean, teachers: Array<{id: string, name: string}>}>} */
  async execute() {
    const configured = this.#teachers();
    if (configured === undefined || configured === null) return { configured: false, teachers: [] };

    let roster;
    try {
      roster = this.#roster();
    } catch (err) {
      // An unreadable roster refuses everyone — same posture as GrownUpGate.
      this.#logger.warn?.('school.teachers.roster-unreadable', { error: err.message });
      return { configured: true, teachers: [] };
    }

    const now = this.#clock();
    const seen = new Set();
    const teachers = [];
    for (const raw of Array.isArray(configured) ? configured : []) {
      if (typeof raw !== 'string' || !raw.trim() || seen.has(raw)) {
        this.#logger.warn?.('school.teachers.bad-shape', { entry: raw ?? null });
        continue;
      }
      seen.add(raw);
      if (!isAdult({ roster, userId: raw, now })) {
        const known = Array.isArray(roster) && roster.some((m) => m?.id === raw);
        this.#logger.warn?.('school.teachers.unresolved', {
          id: raw,
          reason: known ? 'not-a-grown-up' : 'not-on-roster',
        });
        continue;
      }
      const member = roster.find((m) => m?.id === raw);
      teachers.push({ id: raw, name: member.name ?? raw });
    }
    return { configured: true, teachers };
  }
}
