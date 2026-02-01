/**
 * Nutrition data generator
 * Generates food logs with realistic items and macros
 */

import {
  USERS,
  getActiveUsers,
  randomInt,
  randomFloat,
  randomChoice,
  randomChoices,
  randomBool,
  formatDate,
  formatDateTime,
  addDays,
  pastDays,
  uuid,
  shortId,
} from './utils.mjs';

// Meal times
const MEAL_TIMES = ['morning', 'afternoon', 'evening', 'night'];

// Food items with realistic nutrition data
// Format: { label, icon, grams, color (Noom), calories, protein, carbs, fat, fiber }
const FOOD_ITEMS = {
  breakfast: [
    { label: 'Eggs (2)', icon: 'egg', grams: 100, color: 'yellow', calories: 155, protein: 13, carbs: 1, fat: 11, fiber: 0 },
    { label: 'Toast (2 slices)', icon: 'bread', grams: 60, color: 'orange', calories: 160, protein: 5, carbs: 30, fat: 2, fiber: 2 },
    { label: 'Oatmeal', icon: 'bowl', grams: 150, color: 'green', calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4 },
    { label: 'Greek Yogurt', icon: 'yogurt', grams: 170, color: 'green', calories: 100, protein: 17, carbs: 6, fat: 0, fiber: 0 },
    { label: 'Banana', icon: 'banana', grams: 120, color: 'green', calories: 105, protein: 1, carbs: 27, fat: 0, fiber: 3 },
    { label: 'Orange Juice', icon: 'juice', grams: 240, color: 'yellow', calories: 110, protein: 2, carbs: 26, fat: 0, fiber: 0 },
    { label: 'Coffee with Cream', icon: 'coffee', grams: 250, color: 'yellow', calories: 50, protein: 1, carbs: 2, fat: 4, fiber: 0 },
    { label: 'Pancakes (2)', icon: 'pancake', grams: 150, color: 'orange', calories: 290, protein: 7, carbs: 48, fat: 8, fiber: 2 },
    { label: 'Bacon (3 strips)', icon: 'bacon', grams: 35, color: 'orange', calories: 160, protein: 10, carbs: 0, fat: 13, fiber: 0 },
    { label: 'Avocado Toast', icon: 'avocado', grams: 150, color: 'green', calories: 240, protein: 5, carbs: 25, fat: 14, fiber: 6 },
  ],
  lunch: [
    { label: 'Chicken Breast', icon: 'chicken', grams: 150, color: 'green', calories: 230, protein: 43, carbs: 0, fat: 5, fiber: 0 },
    { label: 'Brown Rice', icon: 'rice', grams: 150, color: 'green', calories: 165, protein: 4, carbs: 35, fat: 1, fiber: 2 },
    { label: 'Garden Salad', icon: 'salad', grams: 200, color: 'green', calories: 50, protein: 3, carbs: 10, fat: 0, fiber: 4 },
    { label: 'Turkey Sandwich', icon: 'sandwich', grams: 200, color: 'yellow', calories: 350, protein: 25, carbs: 35, fat: 12, fiber: 3 },
    { label: 'Soup (Chicken)', icon: 'soup', grams: 300, color: 'green', calories: 150, protein: 12, carbs: 15, fat: 5, fiber: 2 },
    { label: 'Burrito Bowl', icon: 'bowl', grams: 350, color: 'yellow', calories: 550, protein: 30, carbs: 60, fat: 20, fiber: 10 },
    { label: 'Grilled Fish', icon: 'fish', grams: 150, color: 'green', calories: 180, protein: 35, carbs: 0, fat: 4, fiber: 0 },
    { label: 'Quinoa Salad', icon: 'salad', grams: 200, color: 'green', calories: 220, protein: 8, carbs: 35, fat: 6, fiber: 5 },
    { label: 'Veggie Wrap', icon: 'wrap', grams: 180, color: 'green', calories: 280, protein: 10, carbs: 40, fat: 10, fiber: 6 },
    { label: 'Lentil Soup', icon: 'soup', grams: 300, color: 'green', calories: 180, protein: 12, carbs: 30, fat: 2, fiber: 8 },
  ],
  dinner: [
    { label: 'Grilled Salmon', icon: 'fish', grams: 180, color: 'green', calories: 350, protein: 40, carbs: 0, fat: 20, fiber: 0 },
    { label: 'Steak', icon: 'steak', grams: 200, color: 'yellow', calories: 450, protein: 45, carbs: 0, fat: 28, fiber: 0 },
    { label: 'Pasta with Sauce', icon: 'pasta', grams: 250, color: 'orange', calories: 380, protein: 12, carbs: 65, fat: 8, fiber: 4 },
    { label: 'Pizza (2 slices)', icon: 'pizza', grams: 200, color: 'orange', calories: 540, protein: 22, carbs: 60, fat: 24, fiber: 4 },
    { label: 'Roasted Vegetables', icon: 'vegetables', grams: 200, color: 'green', calories: 120, protein: 4, carbs: 20, fat: 4, fiber: 6 },
    { label: 'Mashed Potatoes', icon: 'potato', grams: 200, color: 'yellow', calories: 220, protein: 4, carbs: 35, fat: 8, fiber: 3 },
    { label: 'Grilled Chicken Thigh', icon: 'chicken', grams: 150, color: 'green', calories: 250, protein: 28, carbs: 0, fat: 15, fiber: 0 },
    { label: 'Stir Fry', icon: 'wok', grams: 300, color: 'green', calories: 320, protein: 25, carbs: 30, fat: 12, fiber: 5 },
    { label: 'Tacos (3)', icon: 'taco', grams: 250, color: 'yellow', calories: 480, protein: 24, carbs: 45, fat: 22, fiber: 6 },
    { label: 'Sushi Roll', icon: 'sushi', grams: 200, color: 'yellow', calories: 350, protein: 15, carbs: 50, fat: 10, fiber: 2 },
  ],
  snacks: [
    { label: 'Apple', icon: 'apple', grams: 180, color: 'green', calories: 95, protein: 0, carbs: 25, fat: 0, fiber: 4 },
    { label: 'Almonds (1oz)', icon: 'nuts', grams: 28, color: 'yellow', calories: 165, protein: 6, carbs: 6, fat: 14, fiber: 4 },
    { label: 'Protein Bar', icon: 'bar', grams: 60, color: 'yellow', calories: 200, protein: 20, carbs: 22, fat: 7, fiber: 3 },
    { label: 'Cheese Stick', icon: 'cheese', grams: 28, color: 'yellow', calories: 80, protein: 7, carbs: 0, fat: 6, fiber: 0 },
    { label: 'Carrot Sticks', icon: 'carrot', grams: 100, color: 'green', calories: 40, protein: 1, carbs: 10, fat: 0, fiber: 3 },
    { label: 'Hummus & Crackers', icon: 'hummus', grams: 80, color: 'yellow', calories: 180, protein: 5, carbs: 20, fat: 10, fiber: 3 },
    { label: 'Dark Chocolate', icon: 'chocolate', grams: 30, color: 'orange', calories: 170, protein: 2, carbs: 13, fat: 12, fiber: 3 },
    { label: 'Granola Bar', icon: 'bar', grams: 40, color: 'yellow', calories: 150, protein: 3, carbs: 25, fat: 5, fiber: 2 },
    { label: 'Trail Mix', icon: 'nuts', grams: 40, color: 'yellow', calories: 200, protein: 5, carbs: 20, fat: 12, fiber: 2 },
    { label: 'Cottage Cheese', icon: 'cheese', grams: 120, color: 'green', calories: 110, protein: 14, carbs: 5, fat: 4, fiber: 0 },
  ],
};

/**
 * Get meal time based on hour
 */
function getMealTimeFromHour(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 15) return 'afternoon';
  if (hour >= 15 && hour < 20) return 'evening';
  return 'night';
}

/**
 * Generate a food log entry
 */
function generateFoodLogEntry(date, userId, mealTime, items) {
  const entryId = `log-${shortId()}`;
  const conversationId = userId;

  // Calculate total nutrition
  const nutrition = items.reduce((acc, item) => ({
    calories: acc.calories + item.calories,
    protein: acc.protein + item.protein,
    carbs: acc.carbs + item.carbs,
    fat: acc.fat + item.fat,
    fiber: acc.fiber + item.fiber,
    sodium: acc.sodium + randomInt(100, 400), // Estimate sodium
    sugar: acc.sugar + randomInt(0, 10), // Estimate sugar
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, sugar: 0 });

  // Create item entries
  const mealItems = items.map((item, idx) => ({
    id: `item-${shortId()}`,
    uuid: uuid(),
    label: item.label,
    icon: item.icon,
    grams: item.grams,
    unit: 'g',
    amount: item.grams,
    color: item.color,
  }));

  // Set time based on meal
  const hourMap = { morning: 8, afternoon: 12, evening: 18, night: 21 };
  const hour = hourMap[mealTime] + randomInt(-1, 1);
  const entryDate = new Date(date);
  entryDate.setHours(hour, randomInt(0, 59), 0, 0);

  return {
    id: entryId,
    userId,
    conversationId,
    status: randomChoice(['accepted', 'accepted', 'accepted', 'pending']),
    text: items.map(i => i.label).join(', '),
    meal: {
      date: formatDate(date),
      time: mealTime,
    },
    items: mealItems,
    questions: [],
    nutrition,
    metadata: {
      source: 'telegram',
      timezone: 'America/Los_Angeles',
      messageId: String(randomInt(10000, 99999)),
      originalText: items.map(i => i.label).join(', '),
      aiModel: 'gpt-4',
      processingTimeMs: randomInt(800, 2000),
    },
    timezone: 'America/Los_Angeles',
    createdAt: formatDateTime(entryDate),
    updatedAt: formatDateTime(entryDate),
    acceptedAt: randomBool(0.9) ? formatDateTime(addDays(entryDate, 0)) : null,
  };
}

/**
 * Generate daily food log for a user
 */
export function generateDailyLog(date, user) {
  const entries = [];
  const userId = user.id;

  // Morning meal (80% chance)
  if (randomBool(0.8)) {
    const items = randomChoices(FOOD_ITEMS.breakfast, randomInt(2, 4));
    entries.push(generateFoodLogEntry(date, userId, 'morning', items));
  }

  // Afternoon meal (90% chance)
  if (randomBool(0.9)) {
    const items = randomChoices(FOOD_ITEMS.lunch, randomInt(2, 4));
    entries.push(generateFoodLogEntry(date, userId, 'afternoon', items));
  }

  // Evening meal (95% chance)
  if (randomBool(0.95)) {
    const items = randomChoices(FOOD_ITEMS.dinner, randomInt(2, 4));
    entries.push(generateFoodLogEntry(date, userId, 'evening', items));
  }

  // Snacks (60% chance)
  if (randomBool(0.6)) {
    const time = randomChoice(['morning', 'afternoon', 'evening']);
    const items = randomChoices(FOOD_ITEMS.snacks, randomInt(1, 2));
    entries.push(generateFoodLogEntry(date, userId, time, items));
  }

  return entries;
}

/**
 * Generate nutrition logs for a date range
 */
export function generateNutritionLogs(startDate, days, users = getActiveUsers()) {
  const logs = {};

  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);

    for (const user of users) {
      const dailyEntries = generateDailyLog(date, user);
      for (const entry of dailyEntries) {
        logs[entry.id] = entry;
      }
    }
  }

  return logs;
}

/**
 * Generate user nutrilog file (hot storage)
 */
export function generateUserNutrilog(userId, logs) {
  const userLogs = {};
  for (const [id, log] of Object.entries(logs)) {
    if (log.userId === userId) {
      userLogs[id] = log;
    }
  }
  return userLogs;
}

/**
 * Group logs by month for archival structure
 */
export function groupLogsByMonth(logs) {
  const grouped = {};

  for (const [id, log] of Object.entries(logs)) {
    const month = log.meal.date.substring(0, 7); // YYYY-MM
    if (!grouped[month]) {
      grouped[month] = {};
    }
    grouped[month][id] = log;
  }

  return grouped;
}

/**
 * Generate nutrichart (summary for display)
 * This is the format used in history/nutrichart.yml
 */
export function generateNutrichart(logs) {
  const chart = [];

  // Group by date and user
  const byDateUser = {};
  for (const log of Object.values(logs)) {
    const key = `${log.meal.date}|${log.userId}`;
    if (!byDateUser[key]) {
      byDateUser[key] = [];
    }
    byDateUser[key].push(log);
  }

  for (const [key, dayLogs] of Object.entries(byDateUser)) {
    const [date, userId] = key.split('|');
    const totals = dayLogs.reduce((acc, log) => ({
      calories: acc.calories + log.nutrition.calories,
      protein: acc.protein + log.nutrition.protein,
      carbs: acc.carbs + log.nutrition.carbs,
      fat: acc.fat + log.nutrition.fat,
      fiber: acc.fiber + log.nutrition.fiber,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

    chart.push({
      date,
      userId,
      meals: dayLogs.length,
      ...totals,
    });
  }

  // Sort by date descending
  chart.sort((a, b) => b.date.localeCompare(a.date));

  return { entries: chart };
}
