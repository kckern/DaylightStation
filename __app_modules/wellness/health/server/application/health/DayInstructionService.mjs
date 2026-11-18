import { sha256Text } from '#system/utils/sha256.mjs';
import { v4 as uuidv4 } from 'uuid';
import { MEAL_BUCKETS } from '../../../portable/contracts/health/mealBuckets.mjs';
import { NUTRIENT_KEYS } from '../../../portable/contracts/health/foodQuantity.mjs';
import { isCountedRow } from '../../../portable/contracts/nutrition/countedRows.mjs';
import { isReconstructedRow } from '../../../portable/contracts/nutrition/reconstruction.mjs';
import { dayName } from './DayInstructionReader.mjs';
import { indexByLinkId } from './MealFoodCommands.mjs';

const fail = (message, status = 422, code = 'INVALID_DAY_INSTRUCTION') => { throw Object.assign(new Error(message), { status, code }); };
const idOf = row => row.uuid || row.id;
const nameOf = row => row.name || row.item || row.label || 'Food';
const isFood = row => row.kind !== 'group';
const isMeal = meal => MEAL_BUCKETS.some(bucket => bucket.id === meal);
const mealLabel = id => MEAL_BUCKETS.find(bucket => bucket.id === id)?.label || id;
const AMENDABLE = ['name', 'grams', 'amount', 'unit', ...NUTRIENT_KEYS];
const versionsOf = rows => Object.fromEntries(rows.map(row => [idOf(row), row.version ?? 1]));
/** A dish's parts, which may name it by either its uuid or its short ID. */
const partsOf = (dish, rows) => {
  const byLinkId = indexByLinkId(rows);
  return rows.filter(row => row.parentId && byLinkId.get(row.parentId) === dish);
};
const movedMessage = (count, first, toDate, toMeal, today) => {
  const what = count === 1 ? nameOf(first || {}) : `${count} foods`;
  const where = [toDate && dayName(toDate, today), toMeal && mealLabel(toMeal)].filter(Boolean).join(', ');
  return `Moved ${what} to ${where}`;
};
const loggedMessage = (rows, loggedDate, date, today) => {
  const foods = rows.filter(isFood);
  const what = foods.length === 1 ? nameOf(foods[0]) : `${foods.length} foods`;
  return `Logged ${what}${loggedDate === date ? '' : ` to ${dayName(loggedDate, today)}`}`;
};

/** Carries out one day-level instruction. The gateway chooses; this validates and commits. */
export class DayInstructionService {
  constructor({ nutritionItems, reader, mealCommands, entryRevisions, logger = {} }) {
    Object.assign(this, { nutritionItems, reader, mealCommands, entryRevisions, logger });
  }
  get available() { return Boolean(this.reader?.available); }

  async execute(userId, { text, date, today, operationId, resolved = {}, captureFoods }) {
    if (!this.available) fail('Day input is unavailable right now', 503, 'DAY_INPUT_UNAVAILABLE');
    const said = String(text || '').trim();
    if (!said) fail('Say or type what to log or change');
    // Without a caller's ID there is no retry to recognise, and the same words
    // said again later are a new request.
    const context = { userId, said, date, today, resolved, captureFoods, operationId: operationId || uuidv4() };
    // This comes before reading the day: a committed move may have emptied it,
    // and the same words would then read as new food.
    const replayed = await this.#replay(context);
    if (replayed) return replayed;
    const dayRows = await this.nutritionItems.findByDate(userId, date);
    const rows = dayRows.filter(row => isCountedRow(row) && !isReconstructedRow(row));
    let plan = null;
    if (rows.length) {
      const latest = this.#latestCapture(rows);
      plan = await this.#reading(() => this.reader.read({ text: said, date, today, foods: rows.filter(isFood).map(nameOf), latest: latest.filter(isFood).map(nameOf) }));
      this.logger.info?.('health.day_instruction.read', { userId, date, ...plan });
    }
    if (plan?.compound) return this.#reply(said, { committed: false, outcome: 'no-change', message: 'Please make one change at a time.' });
    if (plan?.intent === 'other') return this.#reply(said, { committed: false, outcome: 'no-change', message: "I can log food, move it, or correct it. I can't do that here." });
    if (!plan || plan.intent === 'add') return this.#add(context);
    return plan.intent === 'change' ? this.#change(context, rows, dayRows, plan) : this.#move(context, rows, dayRows, plan);
  }

  /** The reply for a write this operation already committed, rebuilt from its stored result. */
  async #replay(context) {
    const { userId, said, date, today } = context;
    const stored = step => this.nutritionItems.readOperationResult?.(userId, this.#child(context, step));
    const moved = await stored('move');
    if (moved) {
      const tops = (moved.items || []).filter(row => !row.parentId);
      return this.#reply(said, { ...moved, outcome: 'committed', kind: 'moved',
        message: movedMessage(moved.movedCount ?? tops.length, tops[0], moved.toDate, moved.toMeal, today) });
    }
    const changed = await stored('change');
    if (changed) return this.#reply(said, { ...changed, outcome: 'committed', kind: 'changed', message: `Changed to ${nameOf(changed.items?.[0] || {})}` });
    const placed = await stored('place');
    if (placed) {
      const items = placed.items || [];
      return this.#reply(said, { ...placed, outcome: 'committed', kind: 'added', logId: items[0]?.logId,
        message: loggedMessage(items, placed.date || date, date, today) });
    }
    return null;
  }

  async #reading(run) {
    try { return await run(); }
    catch (error) {
      this.logger.warn?.('health.day_instruction.gateway_failed', { error: error.message });
      fail('Day input is unavailable right now', 503, 'DAY_INPUT_UNAVAILABLE');
    }
    return null;
  }
  #reply(said, body) { return { instructionText: said, ...body }; }
  #child(context, step) { return sha256Text(`${context.operationId}:day:${step}`); }
  #ask(said, kind, question, choices = []) { return this.#reply(said, { committed: false, outcome: 'clarification', clarification: { kind, question, choices } }); }
  #askFood(said, rows) {
    if (!rows.length) return this.#reply(said, { committed: false, outcome: 'no-change', message: 'There is no food here I can change.' });
    return this.#ask(said, 'food', 'Which food did you mean?', rows.map(row => ({ id: idOf(row), label: nameOf(row) })));
  }
  #latestCapture(rows) {
    if (!rows.length) return [];
    const newest = rows.reduce((best, row) => (String(row.createdAt || '') > String(best.createdAt || '') ? row : best), rows[0]);
    return newest.logId ? rows.filter(row => row.logId === newest.logId) : [newest];
  }
  #inScope(rows, plan) {
    if (plan.target === 'latest') return this.#latestCapture(rows);
    if (plan.target === 'meal') return plan.fromMeal === 'none' ? [] : rows.filter(row => row.mealTime === plan.fromMeal);
    return ['whole_day', 'named'].includes(plan.target) ? rows : [];
  }
  #resolvedFood(candidates, foodId) {
    const row = candidates.find(item => idOf(item) === foodId);
    if (!row) fail('That food is not on this day');
    return row;
  }

  async #move(context, rows, dayRows, plan) {
    const { said, date, today, resolved, userId } = context;
    const tops = rows.filter(row => !row.parentId);
    let targets;
    if (resolved.foodId) targets = [this.#resolvedFood(tops, resolved.foodId)];
    else {
      const scoped = this.#inScope(tops, plan);
      if (plan.target === 'named' && scoped.length) {
        const foods = scoped.map(row => ({ id: idOf(row), name: nameOf(row),
          description: [row, ...partsOf(row, rows)].map(nameOf).join(', ') }));
        const matched = new Set(await this.#reading(() => this.reader.matchFoods({ text: said, foods })));
        targets = scoped.filter(row => matched.has(idOf(row)));
      } else targets = scoped;
      if (!targets.length) return this.#askFood(said, tops);
    }
    const requestedDay = resolved.toDate || (!['same', 'older'].includes(plan.toDay) ? plan.toDay : null);
    const toMeal = plan.toMeal === 'same' ? null : plan.toMeal;
    if (!requestedDay && (plan.toDay === 'older' || !toMeal)) return this.#ask(said, 'day', 'Which day should this go to?');
    const toDate = requestedDay === date ? null : requestedDay;
    const moving = targets.filter(row => toDate || (toMeal && row.mealTime !== toMeal));
    if (!moving.length) return this.#reply(said, { committed: false, outcome: 'no-change', message: 'Those foods are already there.' });
    // Parts are read from every row of the day: a move carries a rejected part too.
    const carried = moving.flatMap(row => [row, ...partsOf(row, dayRows)]);
    const result = await this.mealCommands.moveFoods(userId, { operationId: this.#child(context, 'move'), date, today,
      selectedIds: moving.map(idOf), expectedVersions: versionsOf(carried), toDate, toMeal });
    return this.#reply(said, { ...result, outcome: 'committed', kind: 'moved', message: movedMessage(moving.length, moving[0], toDate, toMeal, today) });
  }

  async #change(context, rows, dayRows, plan) {
    const { said, resolved, userId, date } = context;
    if (!this.entryRevisions) fail('Food revision is unavailable', 503);
    const foods = rows.filter(row => isFood(row) && row.mealTime);
    let target;
    if (resolved.foodId) target = this.#resolvedFood(foods, resolved.foodId);
    else {
      const scoped = this.#inScope(foods, plan);
      let matches = scoped;
      if (scoped.length && (plan.target === 'named' || scoped.length > 1)) {
        const ids = new Set(await this.#reading(() => this.reader.matchFoods({ text: said, foods: scoped.map(row => ({ id: idOf(row), name: nameOf(row) })) })));
        matches = scoped.filter(row => ids.has(idOf(row)));
      }
      if (matches.length !== 1) return this.#askFood(said, matches.length ? matches : foods);
      [target] = matches;
    }
    const id = idOf(target);
    const { proposal } = await this.entryRevisions.propose(userId, { entryUuid: id, instruction: said });
    const changes = Object.fromEntries(AMENDABLE.filter(key => Object.hasOwn(proposal, key)).map(key => [key, proposal[key]]));
    // The amend also checks the dish a part belongs to.
    const dish = target.parentId ? indexByLinkId(dayRows).get(target.parentId) : null;
    const result = await this.mealCommands.execute(userId, { action: 'amend', date, bucket: target.mealTime, selectedIds: [id],
      expectedVersions: versionsOf([target, ...(dish ? [dish] : [])]), changes: { [id]: changes }, operationId: this.#child(context, 'change') });
    return this.#reply(said, { ...result, outcome: 'committed', kind: 'changed', message: `Changed ${nameOf(target)} to ${proposal.name}` });
  }

  async #add(context) {
    const { said, date, today, userId, captureFoods } = context;
    const captured = await captureFoods({ text: said, date, operationId: this.#child(context, 'capture') });
    if (!captured?.committed) {
      return this.#reply(said, { committed: false, outcome: captured?.outcome || 'no-food', message: captured?.message || "I couldn't find any food in that." });
    }
    const { logId } = captured;
    const logged = logId ? await this.nutritionItems.findByLogId(userId, logId) : captured.items || [];
    const placed = logId ? await this.#place(context, logId, logged) : null;
    const result = placed || captured;
    return this.#reply(said, { ...result, committed: true, outcome: 'committed', kind: 'added', logId,
      message: loggedMessage(logged, result.date || logged[0]?.date || date, date, today) });
  }

  /** The capture is already committed, so nothing here may fail the request. */
  async #place(context, logId, logged) {
    const { said, userId } = context;
    const tops = new Set(logged.filter(row => !row.parentId).map(idOf));
    let placements = {};
    try {
      const assigned = await this.reader.assignMeals({ text: said, foods: logged.filter(row => !row.parentId).map(row => ({ id: idOf(row), name: nameOf(row) })) });
      placements = Object.fromEntries(Object.entries(assigned || {}).filter(([id, meal]) => tops.has(id) && isMeal(meal)));
    } catch (error) { this.logger.warn?.('health.day_instruction.assign_failed', { userId, logId, error: error.message }); }
    try { return await this.mealCommands.placeCapturedFoods(userId, { operationId: this.#child(context, 'place'), logId, placements }); }
    catch (error) {
      this.logger.warn?.('health.day_instruction.placement_failed', { userId, logId, error: error.message });
      return null;
    }
  }
}
