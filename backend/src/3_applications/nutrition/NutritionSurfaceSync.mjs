import { sha256Text } from '#system/utils/sha256.mjs';
import { isCountedRow, sumCounted } from '#shared/contracts/nutrition/countedRows.mjs';

const fingerprint = value => sha256Text(JSON.stringify(value));
const rowView = row => ({
  id: row.uuid || row.id, name: row.name || row.item || row.label,
  date: row.date, mealTime: row.mealTime, grams: row.grams, amount: row.amount, unit: row.unit,
  icon: row.icon, color: row.color || row.noom_color, kind: row.kind, parentId: row.parentId,
  settled: row.settled,
  ...Object.fromEntries(['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol']
    .map(key => [key, row[key] ?? null])),
});
const ordered = rows => rows.map(rowView).sort((a, b) => String(a.id).localeCompare(String(b.id)));

/** Replicate committed food records to an optional surface; never participate in saves.
 * Checkpoints advance only after successful delivery. The durable source/checkpoint
 * difference is the retry queue, including after restart. First attachment takes a
 * baseline so installing a surface does not replay the user's whole history.
 */
export class NutritionSurfaceSync {
  #deps; #running = null;
  #snapshots = new Map();
  constructor(deps) {
    for (const key of ['users', 'destinationFor', 'linkFor', 'foodLogs', 'items', 'checkpoints', 'surface', 'logger']) {
      if (!deps[key]) throw new Error(`NutritionSurfaceSync requires ${key}`);
    }
    this.#deps = deps;
  }

  run() {
    if (this.#running) return this.#running;
    this.#running = this.#run().finally(() => { this.#running = null; });
    return this.#running;
  }

  async #run() {
    const d = this.#deps;
    for (const userId of await d.users()) {
      try {
        const destination = await d.destinationFor(userId);
        if (destination) await this.#syncUser(userId, destination);
      } catch (error) {
        d.logger.warn('nutrition.surface.retry', { userId, error: error.message });
      }
    }
  }

  async #syncUser(userId, destination) {
    const d = this.#deps;
    const revisions = d.foodLogs.getRevision && d.items.getRevision
      ? JSON.stringify([await d.foodLogs.getRevision(userId), await d.items.getRevision(userId)]) : null;
    let snapshot = this.#snapshots.get(userId);
    if (!revisions || snapshot?.revisions !== revisions) {
      snapshot = { revisions, logs: await d.foodLogs.findAll(userId, { includeArchives: true }),
        rows: (await d.items.findByDateRange(userId, '0001-01-01', '9999-12-31')).filter(isCountedRow) };
      this.#snapshots.set(userId, snapshot);
    }
    const { logs, rows } = snapshot;
    const loaded = await d.checkpoints.load(userId);
    const initial = !loaded || loaded.destination !== destination;
    const state = initial ? { destination, messages: {}, days: {}, reportHistory: {} } : loaded;
    state.links ||= {};
    state.unavailable ||= {};
    let checkpointChanged = initial;
    const days = new Map();
    const byLog = new Map();
    for (const row of rows) {
      if (row.date) { if (!days.has(row.date)) days.set(row.date, []); days.get(row.date).push(row); }
      const logId = row.logId || row.log_uuid;
      if (logId) { if (!byLog.has(logId)) byLog.set(logId, []); byLog.get(logId).push(row); }
    }

    for (const log of logs) {
      let link = d.linkFor(log, destination) || state.links[log.id];
      const pending = log.status === 'pending';
      const renderRows = pending ? (log.items || []).map(row => ({ ...rowView(row), date: log.meal?.date, mealTime: log.meal?.time })) : (byLog.get(log.id) || []);
      const formatRows = values => values.filter(row => row.kind !== 'group').map(row =>
        `${row.date || ''} ${row.mealTime || ''} · ${row.name || row.item || row.label} · ${row.grams != null ? `${row.grams} g` : row.unit === 'ml' ? `${row.amount} ml` : 'weight unknown'} · ${Math.round(row.calories || 0)} kcal`).join('\n');
      const pendingText = `Needs review\n${formatRows(renderRows)}${log.metadata?.nutritionLookup?.warnings?.length ? '\nNutrition needs checking in Health before confirmation.' : ''}`;
      if (!link && pending && d.surface.createPending
        && (log.conversationId === destination || /^(web|device):/.test(log.conversationId || ''))) {
        try {
          link = await d.surface.createPending(destination, log.id, pendingText);
          state.links[log.id] = link;
          await d.checkpoints.save(userId, state);
        } catch (error) {
          d.logger.warn('nutrition.surface.pending.retry', { userId, logId: log.id, error: error.message });
        }
      }
      if (!link) continue;
      if (state.unavailable[String(link.messageId)]) continue;
      const currentRows = byLog.get(log.id) || [];
      const value = { status: log.status, ...(pending ? { meal: log.meal, nutritionLookup: log.metadata?.nutritionLookup } : {}), rows: log.status === 'pending'
        ? ordered(log.items || []) : ordered(currentRows) };
      const key = String(link.messageId);
      const next = fingerprint(value);
      if (state.messages[key] === next) continue;
      // Pending prompts keep their existing portion/revision controls. They
      // become a receipt only when the shared record has been resolved.
      if (initial || (pending && !state.messages[key])) {
        state.messages[key] = next;
        checkpointChanged = true;
        continue;
      }
      const removed = log.status !== 'accepted' || !currentRows.length;
      const title = removed ? 'Removed from food log' : 'Food log updated';
      const text = pending ? pendingText : `${title}\n${removed ? (log.items || []).map(row => row.label).join(', ') : formatRows(currentRows)}`;
      try {
        if (pending) await d.surface.updateMessage(destination, link, text, { pending: log.id });
        else await d.surface.updateMessage(destination, link, text);
        state.messages[key] = next;
        await d.checkpoints.save(userId, state);
        d.logger.info('nutrition.surface.message.updated', { userId, logId: log.id, messageId: key });
      } catch (error) {
        if (error.permanent) {
          state.unavailable[key] = { reason: error.message };
          await d.checkpoints.save(userId, state);
        }
        d.logger.warn('nutrition.surface.message.retry', { userId, logId: log.id, error: error.message });
      }
    }

    // Include vanished days: deleting the last item must replace the stale
    // nonzero report with an empty-day report. Moves update both dates.
    for (const date of [...new Set([...Object.keys(state.days), ...days.keys()])].sort()) {
      const items = days.get(date) || [];
      const history = [];
      for (let offset = 6; offset >= 1; offset--) {
        const previous = new Date(`${date}T12:00:00Z`);
        previous.setUTCDate(previous.getUTCDate() - offset);
        const day = previous.toISOString().slice(0, 10);
        const entries = days.get(day) || [];
        history.push({ date: day, ...Object.fromEntries(['calories', 'protein', 'carbs', 'fat']
          .map(key => [key, sumCounted(entries, key)])) });
      }
      const next = fingerprint(ordered(items));
      const historyVersion = fingerprint(history);
      // Refresh history in reports this worker actually published, without
      // creating six unrelated historical reports for every backdated edit.
      if (state.days[date] === next && (!state.reportHistory[date] || state.reportHistory[date] === historyVersion)) continue;
      if (!initial) {
        try {
          await d.surface.report({ userId, conversationId: destination, date, items, history });
          state.reportHistory[date] = historyVersion;
          d.logger.info('nutrition.surface.report.updated', { userId, date, itemCount: items.length });
        } catch (error) {
          d.logger.warn('nutrition.surface.report.retry', { userId, date, error: error.message });
          continue;
        }
      }
      state.days[date] = next;
      if (!initial) await d.checkpoints.save(userId, state);
    }
    if (checkpointChanged) await d.checkpoints.save(userId, state);
    if (initial) d.logger.info('nutrition.surface.attached', { userId });
  }
}
