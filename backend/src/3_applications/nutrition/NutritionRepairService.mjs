import { sha256Text } from '#system/utils/sha256.mjs';
import { validateCleanup, entryKey, CLEANUP_FIELDS } from '#domains/nutrition/services/cleanupPolicy.mjs';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };

/** The only auditor mutation capability. Models never receive this service as a tool. */
export class NutritionRepairService {
  constructor({ items, clock, timezoneFor, review, foodLogs, icons }) { Object.assign(this, { items, clock, timezoneFor, review, foodLogs, icons }); }
  async apply({ userId, operationId, runId, proposal, evidence, userDirected = false, signal, fence = () => true, dryRun = false }) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId || '')) fail('Invalid operation ID', 400);
    const fingerprint = sha256Text(JSON.stringify({ proposal, evidence, userDirected }));
    const prior = await this.items.getCleanupAudit(userId, operationId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail('Operation ID already used');
      return prior.result;
    }
    if (!proposal.reason || !evidence.length) fail('Repair requires evidence and a reason');
    const updates = structuredClone(proposal.updates || []);
    const capture = proposal.logUuid ? await this.foodLogs.findById(userId, proposal.logUuid) : null;
    const creates = [];
    const groupedChildren = new Set();
    for (const [index, group] of (proposal.createGroups || []).entries()) {
      if (!group.children?.length) fail('A group requires existing children');
      const hash = sha256Text(operationId + ':' + index);
      const parentId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const child = capture?.items.find(row => row.id === group.children[0].id || row.uuid === group.children[0].id);
      const first = proposal.logUuid ? child && { date: capture.meal.date, mealTime: capture.meal.time, logUuid: capture.id }
        : await this.items.findByUuid(userId, group.children[0].id);
      if (!first) fail('Group child not found');
      creates.push({ id: parentId, uuid: parentId, label: group.label, name: group.label, kind: 'group',
        date: first.date, mealTime: first.mealTime, logUuid: first.logUuid || first.log_uuid || first.logId,
        icon: 'default', color: 'yellow', amount: 1, unit: 'group', grams: null, calories: 0, protein: 0, carbs: 0, fat: 0,
        fiber: 0, sugar: 0, sodium: 0, cholesterol: 0 });
      for (const child of group.children) {
        if (groupedChildren.has(child.id)) fail('A food cannot belong to multiple new groups');
        groupedChildren.add(child.id);
        const existing = updates.find(update => update.id === child.id);
        if (existing) {
          if (existing.expectedVersion !== child.expectedVersion) fail('Conflicting child versions');
          existing.changes.parentId = parentId;
        }
        else updates.push({ ...child, changes: { parentId } });
      }
    }
    for (const update of updates) {
      if (update.changes.icon && update.changes.icon !== 'default'
        && (!this.icons?.has(update.changes.icon) || (this.icons.resolve && !this.icons.resolve(update.changes.icon)))) fail('Artwork is unavailable');
      if (update.changes.label !== undefined) { update.changes.name = update.changes.label; delete update.changes.label; }
    }
    if (new Set(updates.map(update => update.id)).size !== updates.length) fail('Repeated food update');
    if (proposal.logUuid) return this.review.repair({
      userId, logUuid: proposal.logUuid, expectedVersion: proposal.expectedLogVersion, operationId, fingerprint,
      proposal: { ...proposal, updates }, creates, evidence, runId, userDirected, clock: this.clock,
      timezone: this.timezoneFor(userId), signal, fence, dryRun,
    });
    if (!updates.length && !creates.length) return { items: [], affectedIds: [], affectedDates: [] };
    return this.items.mutateEntries(userId, {
      updates, creates, dryRun,
      audit: { id: operationId, runId, fingerprint, reason: proposal.reason, evidence,
        actor: userDirected ? 'user-answer' : 'nutrition-auditor', at: new Date(this.clock.now()).toISOString() },
      validate: ({ before, after }) => {
        signal?.throwIfAborted();
        if (!fence()) fail('Repair run is no longer active');
        validateCleanup({ before, after, updates, creates, evidence, userId,
          userDirected, now: this.clock.now(), timezone: this.timezoneFor(userId) });
        for (const update of updates) {
          const row = after.find(row => row.id === update.id || row.uuid === update.id);
          const original = before.find(row => row.id === update.id || row.uuid === update.id);
          const fields = Object.keys(update.changes).filter(key => JSON.stringify(original[key]) !== JSON.stringify(row[key]));
          if (!fields.length) continue;
          const key = userDirected ? 'manualFields' : 'cleanupFields';
          row[key] = [...new Set([...(row[key] || []), ...fields])];
        }
      },
    });
  }

  async undo({ userId, repairId, operationId }) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId || '')) fail('Invalid operation ID', 400);
    const repair = await this.items.getCleanupAudit(userId, repairId);
    if (!repair) return this.review.undoRepair({ userId, repairId, clock: this.clock });
    const undoId = 'undo_' + repairId;
    const prior = await this.items.getCleanupAudit(userId, undoId);
    if (prior) return prior.result;
    const before = new Map(repair.before.map(row => [entryKey(row), row]));
    const updates = repair.after.filter(row => before.has(entryKey(row))).map(row => {
      const original = before.get(entryKey(row));
      const changes = Object.fromEntries(CLEANUP_FIELDS.filter(key => JSON.stringify(original[key]) !== JSON.stringify(row[key]))
        .map(key => [key, original[key] ?? null]));
      if ('name' in changes) changes.name = original.name || original.label || original.item;
      // Undo is an explicit manual decision: prevent reapplying the same fix.
      changes.manualFields = [...new Set([...(original.manualFields || []), ...CLEANUP_FIELDS.filter(key => JSON.stringify(original[key]) !== JSON.stringify(row[key]))])];
      return { id: entryKey(row), expectedVersion: row.version ?? 1, changes };
    });
    const deleteIds = repair.after.filter(row => !before.has(entryKey(row))).map(entryKey);
    return this.items.mutateEntries(userId, {
      updates, deleteIds,
      audit: { id: undoId, fingerprint: repair.fingerprint, undoOf: repairId, actor: 'user',
        reason: 'Undo cleanup', evidence: [], at: new Date(this.clock.now()).toISOString() },
      validate: ({ before: current, after: restored }) => {
        for (const after of repair.after) {
          const row = current.find(item => entryKey(item) === entryKey(after));
          if (!row || (row.version ?? 1) !== (after.version ?? 1)) fail('This entry changed after cleanup; edit it manually instead');
        }
        const deletedAliases = new Set(repair.after.filter(row => deleteIds.includes(entryKey(row))).flatMap(row => [row.id, row.uuid]));
        if (restored.some(row => row.parentId && deletedAliases.has(row.parentId))) fail('This group has new members; edit it manually instead');
        for (const update of updates) {
          const row = restored.find(row => entryKey(row) === update.id);
          if (!row?.parentId) continue;
          const parent = restored.find(parent => parent.id === row.parentId || parent.uuid === row.parentId);
          if (!parent || parent.kind !== 'group' || parent.date !== row.date || parent.mealTime !== row.mealTime) fail('The original group changed; edit it manually instead');
        }
      },
    });
  }
}
