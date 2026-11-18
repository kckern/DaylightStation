import { choice, yesNo } from '#apps/common/ports/IDecisionGateway.mjs';
import { MEAL_BUCKETS } from '../../../portable/contracts/health/mealBuckets.mjs';

const at = iso => new Date(`${iso}T12:00:00Z`);
export const addDaysISO = (iso, days) => { const value = at(iso); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
export function dayName(iso, today) {
  if (iso === today) return 'Today';
  if (iso === addDaysISO(today, -1)) return 'Yesterday';
  return at(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const meals = () => Object.fromEntries(MEAL_BUCKETS.map(bucket => [bucket.id, bucket.label]));
const foodState = foods => Object.fromEntries(foods.map((food, index) => [`food_${index}`, food.description || food.name]));

// A malformed answer must stop here: acting on it could move the wrong rows.
const picked = (answers, id, options) => {
  const answer = answers[id];
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string' || !Object.hasOwn(options, answer.choice)) throw new Error(`Invalid decision answer: ${id}`);
  return answer.choice;
};
const isYes = (answers, id) => {
  const answer = answers[id];
  if (answer?.type !== 'yesNo' || !Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) throw new Error(`Invalid decision answer: ${id}`);
  return answer.probability >= 0.5;
};

/** Typed readings of one utterance. Answers are options, never free text. */
export class DayInstructionReader {
  #gateway;
  constructor({ decisionGateway = null } = {}) { this.#gateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway; }
  get available() { return Boolean(this.#gateway); }

  async read({ text, date, today, foods, latest }) {
    const intentOptions = {
      add: 'It reports food eaten that still needs logging, including food it says was forgotten or also eaten, even if a similar food is already listed',
      move: 'It says listed food belongs on another day or in another meal',
      change: 'It corrects what a listed food actually was or how much of it there was',
      other: 'It asks for something this cannot do, such as deleting food, or it is a question',
    };
    const targetOptions = {
      latest: 'The most recent capture: `said` points with "that", "these", "those" or "it" instead of naming a listed food, even if it goes on to name a meal, a day, or what the food really was; see `latest_capture`',
      whole_day: 'Everything on this day, with words like "all of this", "everything" or "the whole day"; "all of this" means the whole day even though "this" is a pointing word',
      meal: 'Everything in one meal',
      named: 'Particular foods or a kind of food, such as "the drinks"',
    };
    const fromMealOptions = { ...meals(), none: 'No meal is named as the one the food is leaving' };
    const toMealOptions = { same: 'No meal change was asked for', ...meals() };
    const toDayOptions = { same: 'No day change was asked for', older: 'A specific day older than every listed day' };
    for (let index = 0; index < 7; index += 1) {
      const iso = addDaysISO(today, -index);
      if (iso !== date) toDayOptions[iso] = `${dayName(iso, today)} (${at(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, ${iso})`;
    }
    const { answers } = await this.#gateway.evaluate({ said: text, viewed_day: dayName(date, today), foods_on_this_day: foods, latest_capture: latest }, {
      intent: choice('What does `said` ask for, given `foods_on_this_day` on `viewed_day`?', intentOptions),
      target: choice('Which of `foods_on_this_day` on `viewed_day` does `said` refer to? A pointing word such as "that" means `latest_capture`, even when `latest_capture` looks nothing like what `said` says the food really was. "All of this" and "everything" mean the whole day instead.', targetOptions),
      fromMeal: choice('Which meal does `said` say the food is being moved out of?', fromMealOptions),
      toMeal: choice('According to `said`, which meal should the food it mentions move to?', toMealOptions),
      toDay: choice('According to `said`, which day should the food it mentions move to?', toDayOptions),
      compound: yesNo('Does `said` ask for two or more separate changes, such as moving one food and correcting another, moving foods to different places, or logging a new food and also changing a logged one? Reporting several foods eaten, even at different meals, is one request, and so is sending several foods to the same place.'),
    });
    return {
      intent: picked(answers, 'intent', intentOptions),
      target: picked(answers, 'target', targetOptions),
      fromMeal: picked(answers, 'fromMeal', fromMealOptions),
      toMeal: picked(answers, 'toMeal', toMealOptions),
      toDay: picked(answers, 'toDay', toDayOptions),
      compound: isYes(answers, 'compound'),
    };
  }

  async matchFoods({ text, foods }) {
    if (!foods.length) return [];
    const questions = Object.fromEntries(foods.map((_food, index) => [`food_${index}`, yesNo(`Does \`said\` refer to \`food_${index}\`?`)]));
    const { answers } = await this.#gateway.evaluate({ said: text, ...foodState(foods) }, questions);
    return foods.filter((_food, index) => isYes(answers, `food_${index}`)).map(food => food.id);
  }

  async assignMeals({ text, foods }) {
    if (!foods.length) return {};
    const options = { ...meals(), unsaid: 'The words do not say or imply when this was eaten' };
    const questions = Object.fromEntries(foods.map((_food, index) => [`meal_${index}`, choice(`According to \`said\`, at which meal was \`food_${index}\` eaten?`, options)]));
    const { answers } = await this.#gateway.evaluate({ said: text, ...foodState(foods) }, questions);
    return Object.fromEntries(foods.flatMap((food, index) => {
      const meal = picked(answers, `meal_${index}`, options);
      return meal === 'unsaid' ? [] : [[food.id, meal]];
    }));
  }
}
