/**
 * LiveHouseholdCalendar — the household calendar (`school.yml → calendar`) and
 * its keep-lists (`dayOffTiers`) as one swappable value.
 *
 * Both used to be validated once at boot and handed to every consumer as a
 * plain value, so a change meant a restart. Consumers now take a getter and
 * read it per call; the teacher console's calendar save installs the new pair
 * with `replace()`, and the next agenda, grid row, debrief or reading-wall
 * read sees it.
 */
import { DEFAULT_DAY_OFF_POLICY } from "../domain/dayOffPolicy.mjs";

/** A function passes through; any other value becomes a constant getter. */
export const resolveLive = (value) => (typeof value === 'function' ? value : () => value);

export class LiveHouseholdCalendar {
  #schedule; #policy;

  constructor({ schedule = null, policy = DEFAULT_DAY_OFF_POLICY } = {}) {
    this.#schedule = schedule;
    this.#policy = policy ?? DEFAULT_DAY_OFF_POLICY;
    this.schedule = this.schedule.bind(this);
    this.policy = this.policy.bind(this);
  }

  /** The validated schedule, or null (no house-wide days off / invalid block). */
  schedule() { return this.#schedule; }

  /** The keep-list policy per tier. */
  policy() { return this.#policy; }

  replace({ schedule = null, policy = DEFAULT_DAY_OFF_POLICY } = {}) {
    this.#schedule = schedule;
    this.#policy = policy ?? DEFAULT_DAY_OFF_POLICY;
  }
}

export default LiveHouseholdCalendar;
