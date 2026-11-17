import path from 'node:path';
import moment from 'moment-timezone';
import * as FileIO from '#system/utils/FileIO.mjs';
import { IWorkJournalActivity } from '../application/ports/IWorkJournalActivity.mjs';
import { assertWorkUser, workHash, workError } from '../domain/workState.mjs';
import { validateWorkRef } from '../domain/workModel.mjs';
const stable = event => {
  const {
    observedAt,
    ...source
  } = event;
  return source;
};
export class YamlWorkActivityStore extends IWorkJournalActivity {
  #root;
  #writer;
  #timezone;
  #io;
  #chains = new Map();
  constructor({
    rootForUser,
    assertWriter,
    userTimezone,
    io = FileIO
  }) {
    super();
    if (typeof rootForUser !== 'function' || typeof assertWriter !== 'function' || typeof userTimezone !== 'function') throw new TypeError('Work activity dependencies required');
    this.#root = rootForUser;
    this.#writer = assertWriter;
    this.#timezone = userTimezone;
    this.#io = io;
  }
  #file(username) {
    assertWorkUser(username);
    return path.join(this.#root(username), 'work.yml');
  }
  #load(username) {
    try {
      const data = this.#io.readYamlFromPath(this.#file(username));
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.entries(data).some(([date, rows]) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(rows))) throw workError('INVALID_WORK_ACTIVITY_PROJECTION');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  #event(username, event) {
    if (!event || event.username !== username || typeof event.id !== 'string' || !event.id.startsWith('work:') || !Number.isFinite(event.occurredAt) || event.occurredAt < 0 || !Number.isFinite(event.observedAt) || event.occurredAt > event.observedAt || event.occurredAtEstimated === true || !['created', 'updated', 'completed', 'reopened', 'archived', 'deleted'].includes(event.type) || !['provider', 'journal'].includes(event.origin)) throw workError('INVALID_WORK_ACTIVITY');
    validateWorkRef(event.ref);
    if (!moment.tz.zone(this.#timezone(username))) throw workError('INVALID_WORK_TIMEZONE');
  }
  async read({
    username,
    from,
    to
  }) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw workError('INVALID_WORK_RANGE');
    const data = this.#load(username);
    const rows = Object.values(data).flat();
    for (const row of rows) this.#event(username, row);
    return rows.filter(row => row.occurredAt >= from && row.occurredAt <= to).sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  }
  async upsert({
    username,
    event
  }) {
    this.#event(username, event);
    const captured = structuredClone(event);
    const run = (this.#chains.get(username) ?? Promise.resolve()).then(async () => {
      await this.#writer(username);
      const data = this.#load(username),
        old = Object.values(data).flat().find(row => row.id === captured.id);
      if (old) {
        if (workHash(stable(old)) !== workHash(stable(captured))) throw workError('WORK_ACTIVITY_CONFLICT');
        return {
          applied: false,
          eventId: captured.id
        };
      }
      const day = moment.tz(captured.occurredAt, this.#timezone(username)).format('YYYY-MM-DD');
      data[day] = [...(data[day] ?? []), captured].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
      await this.#writer(username);
      this.#io.saveYamlToPathAtomic(this.#file(username), data, {
        durable: true
      });
      return {
        applied: true,
        eventId: captured.id
      };
    });
    const tail = run.catch(() => {});
    this.#chains.set(username, tail);
    void tail.finally(() => {
      if (this.#chains.get(username) === tail) this.#chains.delete(username);
    });
    return run;
  }
}
