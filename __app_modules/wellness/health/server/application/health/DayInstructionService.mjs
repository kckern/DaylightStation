import { sha256Text } from '#system/utils/sha256.mjs';
import { formatLocalTimestamp } from '#system/utils/time.mjs';
import { v4 as uuidv4 } from 'uuid';
import { MEAL_BUCKETS } from '../../../portable/contracts/health/mealBuckets.mjs';
import { NUTRIENT_KEYS, foodGrams } from '../../../portable/contracts/health/foodQuantity.mjs';
import { isCountedRow } from '../../../portable/contracts/nutrition/countedRows.mjs';
import { isReconstructedRow } from '../../../portable/contracts/nutrition/reconstruction.mjs';
import { SHARED_LOG_IDS } from '../../../portable/contracts/nutrition/sharedLogIds.mjs';
import { addDaysISO, dayName } from './DayInstructionReader.mjs';
import { dishOf, indexByLinkId } from './MealFoodCommands.mjs';

const fail = (message, status = 422, code = 'INVALID_DAY_INSTRUCTION') => { throw Object.assign(new Error(message), { status, code }); };
const idOf = row => row.uuid || row.id;
const nameOf = row => row.name || row.item || row.label || 'Food';
const isFood = row => row.kind !== 'group';
const isMeal = meal => MEAL_BUCKETS.some(bucket => bucket.id === meal);
const mealLabel = id => MEAL_BUCKETS.find(bucket => bucket.id === id)?.label || id;
const QUANTITY = ['grams', 'amount', 'unit'];
const AMENDABLE = ['name', 'color', ...QUANTITY, ...NUTRIENT_KEYS];
// What a resumed capture needs. The full reply can carry photos, which do not belong in the ledger.
const CAPTURE_FIELDS = ['committed', 'outcome', 'message', 'logId', 'items', 'entryIds', 'date', 'mealTime', 'affectedIds', 'affectedDates', 'undoToken', 'instructionText'];
const eligible = rows => rows.filter(row => isCountedRow(row) && !isReconstructedRow(row));
const ZONED_TIME = /\d{2}:\d{2}.*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
/**
 * A capture time as household wall-clock "YYYY-MM-DD HH:mm:ss". The ledger writes
 * that form already. A time carrying a zone is an instant, so it is converted:
 * its leading date can be a different day from the household's.
 */
const stampOf = row => {
  const at = row.createdAt;
  if (!at) return '';
  const instant = at instanceof Date ? at : ZONED_TIME.test(String(at)) ? new Date(at) : null;
  if (instant && !Number.isNaN(instant.getTime())) return formatLocalTimestamp(instant);
  return String(at).slice(0, 19).replace('T', ' ');
};
const dayOf = row => row.date || stampOf(row).slice(0, 10);
/** The name of a day the work happened on, when that is not the day being viewed. */
const otherDay = (day, viewed, today) => (day && day !== viewed ? dayName(day, today) : null);
const forDay = name => (name ? ` for ${name}` : '');
const versionsOf = rows => Object.fromEntries(rows.map(row => [idOf(row), row.version ?? 1]));
/** A dish's parts, which may name it by either its uuid or its short ID. */
const partsOf = (dish, rows) => {
  const byLinkId = indexByLinkId(rows);
  return rows.filter(row => row.parentId && byLinkId.get(row.parentId) === dish);
};
const movedMessage = (count, first, toDate, toMeal, today, from = null) => {
  const what = count === 1 ? nameOf(first || {}) : `${count} foods`;
  const where = [toDate && dayName(toDate, today), toMeal && mealLabel(toMeal)].filter(Boolean).join(', ');
  return `Moved ${what}${from ? ` from ${from}` : ''} to ${where}`;
};
const loggedMessage = (rows, loggedDate, date, today) => {
  const foods = rows.filter(isFood);
  const what = !foods.length ? 'your food' : foods.length === 1 ? nameOf(foods[0]) : `${foods.length} foods`;
  return `Logged ${what}${loggedDate === date ? '' : ` to ${dayName(loggedDate, today)}`}`;
};
const FIELD_NAMES = { label: 'name', item: 'name', noom_color: 'color' };
const fieldNames = fields => (fields || []).map(field => FIELD_NAMES[field] || field);
/** Fields a person or the auditor settled. What a voice correction wrote stays open to the next one. */
const pinsOf = row => {
  const revised = new Set(fieldNames(row.revisedFields));
  return new Set([...fieldNames(row.manualFields), ...fieldNames(row.cleanupFields)].filter(field => !revised.has(field)));
};
/** The part of a proposed correction that may be written to this row. */
const amendmentFor = (row, proposal) => {
  const pins = pinsOf(row);
  const proposed = key => Object.hasOwn(proposal, key);
  const mass = foodGrams(row);
  // Grams, amount and unit describe one quantity, so they stay or go together.
  const quantityPinned = QUANTITY.some(key => pins.has(key));
  const quantityHeld = quantityPinned && QUANTITY.some(proposed);
  const writesQuantity = mass !== null && !quantityPinned && QUANTITY.some(proposed);
  // The proposal's nutrition describes its own mass, not the one being kept.
  const factor = quantityHeld && mass > 0 && proposal.grams > 0 ? mass / proposal.grams : 1;
  const writable = key => proposed(key) && !pins.has(key)
    && (writesQuantity || !QUANTITY.includes(key))
    && !(proposal[key] === null && NUTRIENT_KEYS.includes(key) && row[key] != null);
  const valueOf = key => (NUTRIENT_KEYS.includes(key) && typeof proposal[key] === 'number' ? proposal[key] * factor : proposal[key]);
  const changes = Object.fromEntries(AMENDABLE.filter(writable).map(key => [key, valueOf(key)]));
  // An amend scales every nutrient with the quantity, unless it is given the value to keep.
  if (writesQuantity) for (const key of NUTRIENT_KEYS) if (pins.has(key) && Number.isFinite(row[key])) changes[key] = row[key];
  return { changes, held: quantityHeld || AMENDABLE.some(key => proposed(key) && pins.has(key)) };
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
    const viewed = await this.#readDay(userId, date);
    const latestDay = await this.#latestDay(userId, viewed, today);
    // An empty day is read too: the words may correct food logged somewhere else.
    const plan = await this.#reading(() => this.reader.read({ text: said, date, today, foods: viewed.rows.filter(isFood).map(nameOf),
      latest: this.#latestCapture(latestDay).filter(isFood).map(nameOf), latestDate: latestDay.date }));
    this.logger.info?.('health.day_instruction.read', { userId, date, latestDate: latestDay.date, ...plan });
    if (plan?.compound) return this.#reply(said, { committed: false, outcome: 'no-change', message: 'Please make one change at a time.' });
    if (plan?.intent === 'other') return this.#reply(said, { committed: false, outcome: 'no-change', message: "I can log food, move it, or correct it. I can't do that here." });
    if (!plan || plan.intent === 'add') {
      // An answer to a question is not a description of food.
      if (Object.keys(resolved).length) return this.#sayAgain(said);
      return this.#add(context);
    }
    if (resolved.foodIds) return this.#moveKeptFoods(context, viewed, plan);
    const { foodId } = resolved;
    // With nothing on this day, words about a meal or the whole day have no food
    // to act on. Offer the latest capture rather than guess.
    const onlyAsk = !viewed.rows.length && !foodId && !['latest', 'named'].includes(plan.target);
    const source = foodId ? await this.#dayHolding(userId, foodId, viewed, today)
      : onlyAsk || plan.target === 'latest' ? latestDay : viewed;
    // A named food may be in the latest capture, when that is on another day.
    const other = plan.target === 'named' && !foodId && latestDay !== viewed ? latestDay : null;
    const options = { onlyAsk, other };
    return plan.intent === 'change' ? this.#change(context, source, plan, options) : this.#move(context, source, plan, options);
  }

  async #readDay(userId, date) {
    const dayRows = await this.nutritionItems.findByDate(userId, date);
    return { date, dayRows, rows: eligible(dayRows) };
  }

  /**
   * The day holding the capture "that" means. On a day with food, that is the day
   * itself, unless a newer capture was made on this calendar day and filed on
   * another ("pizza last night", or food just moved away). Food logged on some
   * other date is not what someone looking at this day means. Rows with no time
   * keep their ledger order and lose to such a capture. On an empty day, the newest
   * capture of the last seven days.
   */
  async #latestDay(userId, viewed, today) {
    const foods = viewed.rows.filter(isFood);
    const viewedStamp = foods.map(stampOf).sort().at(-1);
    const elsewhere = eligible(await this.nutritionItems.findByDateRange(userId, addDaysISO(today, -6), today))
      .filter(row => isFood(row) && stampOf(row) && dayOf(row) !== viewed.date
        && (!foods.length || stampOf(row).slice(0, 10) === viewed.date));
    const newest = elsewhere.reduce((best, row) => (!best || stampOf(row) > stampOf(best) ? row : best), null);
    if (!newest || (viewedStamp && stampOf(newest) <= viewedStamp)) return viewed;
    // Later food on that day may fall outside the rule, so the capture is kept too.
    return { ...await this.#readDay(userId, dayOf(newest)), anchor: newest };
  }

  /** The day of an answered food: the viewed day, or its own day among those on offer. */
  async #dayHolding(userId, foodId, viewed, today) {
    if (viewed.rows.some(row => idOf(row) === foodId)) return viewed;
    const row = await this.nutritionItems.findByUuid(userId, foodId);
    const day = row ? dayOf(row) : null;
    return day && day !== viewed.date && day >= addDaysISO(today, -6) && day <= today ? this.#readDay(userId, day) : viewed;
  }

  /**
   * The reply for work this operation already finished, without needing its words
   * again: a voice retry calls this before paying to transcribe. Null means there
   * is nothing to return, or the stored work does not hold the words to continue.
   */
  async resume(userId, { date, today, operationId }) {
    if (!this.available || !operationId) return null;
    return this.#replay({ userId, said: null, date, today, resolved: {}, operationId });
  }

  /** The reply for a write this operation already committed, rebuilt from its stored result. */
  async #replay(context) {
    const { userId, date, today } = context;
    const stored = step => this.nutritionItems.readOperationResult?.(userId, this.#child(context, step));
    const captured = await stored('capture');
    const said = context.said || captured?.instructionText || null;
    const moved = await stored('move');
    if (moved) {
      const tops = (moved.items || []).filter(row => !row.parentId);
      return this.#reply(said, { ...moved, outcome: 'committed', kind: 'moved',
        message: movedMessage(moved.movedCount ?? tops.length, tops[0], moved.toDate, moved.toMeal, today, otherDay(moved.date, date, today)) });
    }
    const changed = await stored('change');
    if (changed) return this.#reply(said, { ...changed, outcome: 'committed', kind: 'changed', message: `Updated ${nameOf(changed.items?.[0] || {})}${forDay(otherDay(changed.date, date, today))}` });
    const placed = await stored('place');
    if (placed) {
      const items = placed.items || [];
      return this.#reply(said, { ...placed, outcome: 'committed', kind: 'added', logId: items[0]?.logId,
        message: loggedMessage(items, placed.date || date, date, today) });
    }
    // The food is logged, so the words must not be read again: they would now
    // be judged against a day that already holds it.
    return captured?.committed && said ? this.#add({ ...context, said }, captured) : null;
  }

  /**
   * Run one child write. A failed one gives its ID back, so a retry can use it.
   * If an abandoned attempt was what blocked this write, try once more now.
   */
  async #childWrite(context, step, write, retried = false) {
    const { userId } = context;
    const id = this.#child(context, step);
    try { return await write(id); }
    catch (error) {
      let cleared = false;
      try { cleared = await this.nutritionItems.clearFailedOperation?.(userId, id); }
      catch (clearError) { this.logger.warn?.('health.day_instruction.clear_failed', { userId, step, error: clearError.message }); }
      if (cleared && error.code === 'IDEMPOTENCY_CONFLICT' && !retried) return this.#childWrite(context, step, write, true);
      throw error;
    }
  }

  async #reading(run) {
    try { return await run(); }
    catch (error) {
      this.logger.warn?.('health.day_instruction.gateway_failed', { error: error.message });
      fail('Day input is unavailable right now', 503, 'DAY_INPUT_UNAVAILABLE');
    }
    return null;
  }
  #reply(said, body) { return { ...(said ? { instructionText: said } : {}), ...body }; }
  #sayAgain(said) { return this.#reply(said, { committed: false, outcome: 'no-change', message: 'Please say that again.' }); }
  #child(context, step) { return sha256Text(`${context.operationId}:day:${step}`); }
  #ask(said, kind, question, choices = [], details = {}) { return this.#reply(said, { committed: false, outcome: 'clarification', clarification: { kind, question, choices, ...details } }); }
  /** Asks which food, from `[day, rows]` groups. A food on another day is labelled with it. */
  #askFood({ said, date, today }, ...groups) {
    const choices = groups.flatMap(([day, rows]) => {
      const name = otherDay(day.date, date, today);
      return rows.map(row => ({ id: idOf(row), label: name ? `${nameOf(row)} (${name})` : nameOf(row) }));
    });
    if (!choices.length) return this.#reply(said, { committed: false, outcome: 'no-change', message: 'There is no food here I can change.' });
    return this.#ask(said, 'food', 'Which food did you mean?', choices);
  }
  /** The rows of a day's latest capture, among `rows`: the chosen capture, or the day's newest. */
  #latestCapture({ rows: dayRows, anchor = null }, rows = dayRows) {
    if (!rows.length) return [];
    // Older rows have no capture time: the ledger keeps a day in the order it was
    // written, so ties go to the later row. A dish header is added after its
    // capture and says nothing about when the food was logged.
    const foods = rows.filter(isFood);
    const candidates = foods.length ? foods : rows;
    const newest = anchor ? rows.find(row => idOf(row) === idOf(anchor))
      : candidates.reduce((best, row) => (stampOf(row) >= stampOf(best) ? row : best));
    if (!newest) return [];
    if (!newest.logId) return [newest];
    if (!SHARED_LOG_IDS.has(newest.logId)) return rows.filter(row => row.logId === newest.logId);
    if (!newest.createdAt) return [newest];
    return rows.filter(row => row.logId === newest.logId && row.createdAt === newest.createdAt);
  }
  /** A food with a broken dish link stands alone, as it does on screen and in moveFoods. */
  #topsOf({ rows, dayRows }) {
    const byLinkId = indexByLinkId(dayRows);
    return rows.filter(row => !dishOf(row, byLinkId));
  }
  /** Top-level foods of the latest capture. A part stands for its whole dish. */
  #latestDishes(day) {
    const byLinkId = indexByLinkId(day.dayRows);
    const top = new Set(this.#topsOf(day));
    return [...new Set(this.#latestCapture(day).map(row => dishOf(row, byLinkId) || row))].filter(row => top.has(row));
  }
  #changeableFoods({ rows }) { return rows.filter(row => isFood(row) && row.mealTime); }
  /** The foods among `rows` that the words refer to. No foods, no question. */
  async #matching(said, rows, describe = () => ({})) {
    if (!rows.length) return [];
    const ids = new Set(await this.#reading(() => this.reader.matchFoods({ text: said, foods: rows.map(row => ({ id: idOf(row), name: nameOf(row), ...describe(row) })) })));
    return rows.filter(row => ids.has(idOf(row)));
  }
  #inScope(rows, plan) {
    if (plan.target === 'meal') return plan.fromMeal === 'none' ? [] : rows.filter(row => row.mealTime === plan.fromMeal);
    return ['whole_day', 'named'].includes(plan.target) ? rows : [];
  }
  #resolvedFood(candidates, foodId) {
    const row = candidates.find(item => idOf(item) === foodId);
    if (!row) fail('That food is not on this day');
    return row;
  }

  async #move(context, source, plan, { onlyAsk = false, other = null } = {}) {
    const { said, resolved } = context;
    const tops = this.#topsOf(source);
    if (onlyAsk) return this.#askFood(context, [source, this.#latestDishes(source)]);
    if (resolved.foodId) return this.#moveFoods(context, source, plan, [this.#resolvedFood(tops, resolved.foodId)]);
    const matchDishes = (day, rows) => this.#matching(said, rows, row => ({ description: [row, ...partsOf(row, day.rows)].map(nameOf).join(', ') }));
    const scoped = plan.target === 'latest' ? this.#latestDishes(source) : this.#inScope(tops, plan);
    const targets = plan.target === 'named' ? await matchDishes(source, scoped) : scoped;
    if (targets.length) return this.#moveFoods(context, source, plan, targets);
    if (!other) return this.#askFood(context, [source, tops]);
    const theirs = this.#latestDishes(other);
    const matched = await matchDishes(other, theirs);
    return matched.length ? this.#moveFoods(context, other, plan, matched) : this.#askFood(context, [source, tops], [other, theirs]);
  }

  /**
   * A day answer that names the foods the question was about. The words are not
   * matched again, so the answer cannot land on different foods. They still give
   * the meal, and if they no longer read as a move, nothing is guessed. Every food
   * must still be a counted top-level row of a day that could have been asked about.
   */
  async #moveKeptFoods(context, viewed, plan) {
    const { said, resolved, userId, today } = context;
    if (plan.intent !== 'move') return this.#sayAgain(said);
    const { foodIds, fromDate } = resolved;
    const onOffer = fromDate === viewed.date || (fromDate >= addDaysISO(today, -6) && fromDate <= today);
    const source = !onOffer ? null : fromDate === viewed.date ? viewed : await this.#readDay(userId, fromDate);
    const kept = new Set(foodIds);
    const targets = source ? this.#topsOf(source).filter(row => kept.has(idOf(row))) : [];
    if (targets.length !== kept.size) {
      this.logger.warn?.('health.day_instruction.kept_foods_stale', { userId, fromDate, requested: kept.size, found: targets.length });
      fail('Those foods are no longer on that day');
    }
    this.logger.info?.('health.day_instruction.kept_foods', { userId, fromDate, toDate: resolved.toDate, count: targets.length });
    return this.#moveFoods(context, source, plan, targets);
  }

  async #moveFoods(context, source, plan, targets) {
    const { said, today, resolved, userId } = context;
    const { date, dayRows } = source;
    const requestedDay = resolved.toDate || (!['same', 'older'].includes(plan.toDay) ? plan.toDay : null);
    const toMeal = plan.toMeal === 'same' ? null : plan.toMeal;
    if (!requestedDay && (plan.toDay === 'older' || !toMeal)) return this.#ask(said, 'day', 'Which day should this go to?', [], { foodIds: targets.map(idOf), fromDate: date });
    const toDate = requestedDay === date ? null : requestedDay;
    const moving = targets.filter(row => toDate || (toMeal && row.mealTime !== toMeal));
    if (!moving.length) return this.#reply(said, { committed: false, outcome: 'no-change', message: 'Those foods are already there.' });
    // Parts are read from every row of the day: a move carries a rejected part too.
    const carried = moving.flatMap(row => [row, ...partsOf(row, dayRows)]);
    const result = await this.#childWrite(context, 'move', operationId => this.mealCommands.moveFoods(userId, { operationId, date, today,
      selectedIds: moving.map(idOf), expectedVersions: versionsOf(carried), toDate, toMeal }));
    return this.#reply(said, { ...result, outcome: 'committed', kind: 'moved', message: movedMessage(moving.length, moving[0], toDate, toMeal, today, otherDay(date, context.date, today)) });
  }

  async #change(context, source, plan, { onlyAsk = false, other = null } = {}) {
    const { said, resolved } = context;
    if (!this.entryRevisions) fail('Food revision is unavailable', 503, 'DAY_INPUT_UNAVAILABLE');
    const foods = this.#changeableFoods(source);
    if (onlyAsk) return this.#askFood(context, [source, this.#latestCapture(source, foods)]);
    if (resolved.foodId) return this.#applyChange(context, source, this.#resolvedFood(foods, resolved.foodId));
    const scoped = plan.target === 'latest' ? this.#latestCapture(source, foods) : this.#inScope(foods, plan);
    const matches = plan.target === 'named' || scoped.length > 1 ? await this.#matching(said, scoped) : scoped;
    if (matches.length === 1) return this.#applyChange(context, source, matches[0]);
    if (matches.length || !other) return this.#askFood(context, [source, matches.length ? matches : foods]);
    const theirs = this.#latestCapture(other, this.#changeableFoods(other));
    const found = await this.#matching(said, theirs);
    if (found.length === 1) return this.#applyChange(context, other, found[0]);
    return found.length ? this.#askFood(context, [other, found]) : this.#askFood(context, [source, foods], [other, theirs]);
  }

  async #applyChange(context, source, target) {
    const { said, userId, today } = context;
    const { date, dayRows } = source;
    const id = idOf(target);
    const { proposal } = await this.#propose(userId, id, said);
    const { changes, held } = amendmentFor(target, proposal);
    if (!Object.keys(changes).length) return this.#reply(said, { committed: false, outcome: 'no-change', message: 'Those details were set by hand, so I left them.' });
    // The amend also checks the dish a part belongs to. A broken link names no dish.
    const dish = dishOf(target, indexByLinkId(dayRows));
    const result = await this.#childWrite(context, 'change', operationId => this.mealCommands.execute(userId, { action: 'amend', date, bucket: target.mealTime, selectedIds: [id],
      expectedVersions: versionsOf([target, ...(dish ? [dish] : [])]), changes: { [id]: changes }, operationId }, { voiceCorrection: true }));
    const renamed = changes.name && changes.name !== nameOf(target);
    const done = `${renamed ? `Changed ${nameOf(target)} to ${changes.name}` : `Updated ${nameOf(target)}`}${forDay(otherDay(date, context.date, today))}`;
    return this.#reply(said, { ...result, outcome: 'committed', kind: 'changed', message: held ? `${done}. I kept the details you set by hand.` : done });
  }

  async #propose(userId, entryUuid, instruction) {
    try { return await this.entryRevisions.propose(userId, { entryUuid, instruction }); }
    catch (error) {
      if (error.code === 'INVALID_REVISION') throw error;
      this.logger.warn?.('health.day_instruction.revision_failed', { userId, entryUuid, error: error.message });
      return fail('Day input is unavailable right now', 503, 'DAY_INPUT_UNAVAILABLE');
    }
  }

  /** Log the words as food, or pick up a capture that an earlier attempt committed. */
  async #add(context, committedCapture = null) {
    const { said, date, today } = context;
    const captured = committedCapture || await this.#capture(context);
    if (!captured?.committed) {
      return this.#reply(said, { committed: false, outcome: captured?.outcome || 'no-food', message: captured?.message || "I couldn't find any food in that." });
    }
    const logId = captured.logId || captured.items?.[0]?.logId;
    const logged = await this.#loggedRows(context, logId, captured);
    const placed = logId ? await this.#place(context, logId, logged) : null;
    const undo = placed ? null : await this.#captureUndo(context, logged, captured);
    const result = placed || captured;
    return this.#reply(said, { ...result, ...undo, committed: true, outcome: 'committed', kind: 'added', logId,
      message: loggedMessage(logged, result.date || logged[0]?.date || date, date, today) });
  }

  #capture(context) {
    const { said, date, userId, captureFoods } = context;
    return this.#childWrite(context, 'capture', operationId => {
      const run = async () => {
        const captured = await this.#settledCapture(userId, await captureFoods({ text: said, date, operationId }));
        return { ...Object.fromEntries(CAPTURE_FIELDS.filter(key => captured?.[key] !== undefined).map(key => [key, captured[key]])), instructionText: said };
      };
      return this.nutritionItems.runOperation
        ? this.nutritionItems.runOperation(userId, operationId, { operation: 'day-capture', text: said, date }, run)
        : run();
    });
  }

  /** A commit can fail after the rows were written. The ledger says whether the food is logged. */
  async #settledCapture(userId, captured) {
    if (captured?.committed || !captured?.logId) return captured;
    const rows = await this.nutritionItems.findByLogId(userId, captured.logId);
    if (!rows.length) return captured;
    this.logger.warn?.('health.day_instruction.capture_commit_incomplete', { userId, logId: captured.logId, rows: rows.length });
    return { ...captured, committed: true, outcome: 'committed' };
  }

  // Everything below runs after the food is committed, so none of it may fail the request.
  async #loggedRows(context, logId, captured) {
    if (logId) {
      try { return await this.nutritionItems.findByLogId(context.userId, logId); }
      catch (error) { this.logger.warn?.('health.day_instruction.logged_read_failed', { userId: context.userId, logId, error: error.message }); }
    }
    return captured.items || [];
  }

  async #place(context, logId, logged) {
    const { said, userId } = context;
    const tops = logged.filter(row => !row.parentId);
    const topIds = new Set(tops.map(idOf));
    let placements = {};
    try {
      const assigned = await this.reader.assignMeals({ text: said, foods: tops.map(row => ({ id: idOf(row), name: nameOf(row) })) });
      placements = Object.fromEntries(Object.entries(assigned || {}).filter(([id, meal]) => topIds.has(id) && isMeal(meal)));
    } catch (error) { this.logger.warn?.('health.day_instruction.assign_failed', { userId, logId, error: error.message }); }
    try {
      return await this.#childWrite(context, 'place', operationId => this.mealCommands.placeCapturedFoods(userId, { operationId, logId, placements }));
    } catch (error) {
      this.logger.warn?.('health.day_instruction.placement_failed', { userId, logId, error: error.message });
      return null;
    }
  }

  /** Placement normally carries the Undo. Without it, the capture gets its own. */
  async #captureUndo(context, logged, captured) {
    const { userId, date } = context;
    const entryIds = logged.length ? logged.map(idOf) : captured.entryIds || [];
    if (!entryIds.length || !this.nutritionItems.recordCaptureUndo) return null;
    try {
      return await this.nutritionItems.recordCaptureUndo(userId, { operationId: this.#child(context, 'capture'), entryIds,
        date: captured.date || logged[0]?.date || date, bucket: captured.mealTime });
    } catch (error) {
      this.logger.warn?.('health.day_instruction.capture_undo_failed', { userId, error: error.message });
      return null;
    }
  }
}
