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

/** Typed readings of one utterance. Answers are options, never free text. */
export class DayInstructionReader {
  #gateway;
  constructor({ decisionGateway = null } = {}) { this.#gateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway; }
  get available() { return Boolean(this.#gateway); }

  async read({ text, date, today, foods, latest }) {
    const dayOptions = { same: 'No day change was asked for', older: 'A specific day older than every listed day' };
    for (let index = 0; index < 7; index += 1) {
      const iso = addDaysISO(today, -index);
      if (iso !== date) dayOptions[iso] = `${dayName(iso, today)} (${at(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, ${iso})`;
    }
    const { answers } = await this.#gateway.evaluate({ said: text, viewed_day: dayName(date, today), foods_on_this_day: foods, latest_capture: latest }, {
      intent: choice('What does `said` ask for, given `foods_on_this_day`?', {
        add: 'It reports food eaten that is not on the list yet',
        move: 'It says listed food belongs on another day or in another meal',
        change: 'It corrects what a listed food actually was or how much of it there was',
      }),
      target: choice('Which listed food does `said` refer to?', {
        latest: 'The most recent capture, with words like "that", "those" or "it"; see `latest_capture`',
        whole_day: 'Everything on this day',
        meal: 'Everything in one meal',
        named: 'Particular foods or a kind of food, such as "the drinks"',
      }),
      fromMeal: choice('If `said` refers to one whole meal, which meal?', meals()),
      toMeal: choice('Which meal should the food go to?', { same: 'No meal change was asked for', ...meals() }),
      toDay: choice('Which day should the food go to?', dayOptions),
      compound: yesNo('Does `said` ask for two or more separate corrections to logged food?'),
    });
    return { intent: answers.intent.choice, target: answers.target.choice, fromMeal: answers.fromMeal.choice,
      toMeal: answers.toMeal.choice, toDay: answers.toDay.choice, compound: answers.compound.probability >= 0.5 };
  }

  async matchFoods({ text, foods }) {
    if (!foods.length) return [];
    const questions = Object.fromEntries(foods.map((_food, index) => [`food_${index}`, yesNo(`Does \`said\` refer to \`food_${index}\`?`)]));
    const { answers } = await this.#gateway.evaluate({ said: text, ...foodState(foods) }, questions);
    return foods.filter((_food, index) => answers[`food_${index}`].probability >= 0.5).map(food => food.id);
  }

  async assignMeals({ text, foods }) {
    if (!foods.length) return {};
    const options = { ...meals(), unsaid: 'The words do not say or imply when this was eaten' };
    const questions = Object.fromEntries(foods.map((_food, index) => [`meal_${index}`, choice(`According to \`said\`, at which meal was \`food_${index}\` eaten?`, options)]));
    const { answers } = await this.#gateway.evaluate({ said: text, ...foodState(foods) }, questions);
    return Object.fromEntries(foods.flatMap((food, index) => {
      const meal = answers[`meal_${index}`].choice;
      return meal === 'unsaid' ? [] : [[food.id, meal]];
    }));
  }
}
