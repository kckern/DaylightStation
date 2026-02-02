# Health Coach Agent Design

> Proactive health accountability coach with nutrition, workout, and Lifeplan integration

**Last Updated:** 2026-02-02
**Status:** Design Complete, Ready for Implementation
**Parent Design:** [Agents Domain Design](./2026-02-02-agents-domain-design.md)

---

## Overview

**HealthCoachAgent** is a conversational AI coach that helps users achieve health goals through accountability, data-driven insights, and practical guidance. It integrates weight tracking, nutrition logging, workout data, and Lifeplan goals into a unified coaching experience.

**Core Question Answered:** "How do I stay on track with my health goals without constantly doing the math myself?"

---

## The Vision

### Morning Briefings

```
🏃 Morning check-in:

You're down 0.8 lbs this week — right on target for 1 lb/week.
Yesterday you hit 2,100 cal (150 under target) with 140g protein.
Nice work on the protein.

Today: Aim for 2,250 cal, 145g protein. You did legs yesterday,
so today's a good rest day or light cardio.
```

### Nutrition Guidance

```
User: "What should I eat for dinner?"

Coach: You've had 1,400 cal and 85g protein today. You have room
for ~800 cal and need 55g more protein.

From your recent meals:
- Salmon with rice (yesterday) - 520 cal, 42g protein
- Chicken stir fry (Monday) - 480 cal, 38g protein

Either would get you close to your targets.
```

### Workout Awareness

```
Coach: You ran 5K yesterday (320 cal burned). Your weekly activity
is on track — 3 workouts so far. Tomorrow would be a good day for
strength training based on your pattern.
```

### Goal Integration

```
Coach: Your Lifeplan goal is "Reach 175 lbs by June." At your current
pace of -0.8 lbs/week, you'll hit 175 lbs around May 20 — ahead of
schedule. Keep it up.
```

---

## Data Sources

### Read Sources

| Source | What It Provides | Infrastructure |
|--------|------------------|----------------|
| Weight data | lbs, body fat %, lean mass, 7-day trend | `healthStore.loadWeightData()` |
| Nutrition | Daily calories, macros, food items | `healthStore.loadNutritionData()`, `nutriListStore` |
| Workouts | Strava + FitnessSyncer activities | `healthStore.loadActivityData()`, `loadFitnessData()` |
| Lifeplan | JOP goals, quarterly objectives | Lifeplan domain |
| Coaching history | Previous conversations, insights | `healthStore.loadCoachingData()` |

### Write Sources

| Source | What It Writes |
|--------|----------------|
| Coaching log | Conversation history, insights, recommendations |
| Lifeplan | Goal progress updates (via LifeplanToolFactory) |

---

## HealthToolFactory

```javascript
// backend/src/3_applications/agents/tools/HealthToolFactory.mjs

import { ToolFactory } from './ToolFactory.mjs';

export class HealthToolFactory extends ToolFactory {
  #healthService;
  #healthStore;
  #nutriListStore;

  /**
   * @param {Object} deps
   * @param {Object} deps.healthService - HealthAggregationService
   * @param {Object} deps.healthStore - IHealthDataStore implementation
   * @param {Object} deps.nutriListStore - NutriList store for food items
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    super(deps);
    this.#healthService = deps.healthService;
    this.#healthStore = deps.healthStore;
    this.#nutriListStore = deps.nutriListStore;
  }

  static TOOLS = {
    // =========================================================================
    // Read Tools
    // =========================================================================

    getWeightTrend: {
      name: 'get_weight_trend',
      description: 'Get weight data including current weight, body fat %, lean mass, and 7-day trend',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'integer',
            description: 'Days of history (default 30)',
            default: 30
          }
        }
      }
    },

    getTodayNutrition: {
      name: 'get_today_nutrition',
      description: 'Get nutrition consumed today: calories, protein, carbs, fat, and food items logged',
      parameters: {
        type: 'object',
        properties: {}
      }
    },

    getNutritionHistory: {
      name: 'get_nutrition_history',
      description: 'Get nutrition data for recent days including daily totals and food items',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'integer',
            description: 'Days of history (default 7)',
            default: 7
          }
        }
      }
    },

    getRecentWorkouts: {
      name: 'get_recent_workouts',
      description: 'Get workout activities from Strava and fitness tracker including type, duration, calories',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'integer',
            description: 'Days of history (default 14)',
            default: 14
          }
        }
      }
    },

    getHealthSummary: {
      name: 'get_health_summary',
      description: 'Get comprehensive health snapshot: weight, nutrition, workouts, and progress toward goals',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format, defaults to today'
          }
        }
      }
    },

    getRecentMeals: {
      name: 'get_recent_meals',
      description: 'Get recently logged food items for meal suggestions',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'integer',
            description: 'Days of history (default 7)',
            default: 7
          },
          minProtein: {
            type: 'number',
            description: 'Filter to meals with at least this much protein (grams)'
          }
        }
      }
    },

    // =========================================================================
    // Analysis Tools
    // =========================================================================

    calculateGoalProgress: {
      name: 'calculate_goal_progress',
      description: 'Calculate progress toward a weight or body composition goal, including estimated completion date',
      parameters: {
        type: 'object',
        properties: {
          targetWeight: {
            type: 'number',
            description: 'Target weight in lbs'
          },
          targetBodyFat: {
            type: 'number',
            description: 'Target body fat percentage'
          }
        }
      }
    },

    suggestCalorieTarget: {
      name: 'suggest_calorie_target',
      description: 'Suggest daily calorie target based on current weight, goal, and activity level',
      parameters: {
        type: 'object',
        properties: {
          weeklyLossRate: {
            type: 'number',
            description: 'Target lbs/week loss (e.g., 1.0)',
            default: 1.0
          }
        }
      }
    },

    calculateRemainingMacros: {
      name: 'calculate_remaining_macros',
      description: 'Calculate remaining calories and macros for today based on target and consumed',
      parameters: {
        type: 'object',
        properties: {
          targetCalories: {
            type: 'number',
            description: 'Daily calorie target (uses suggested if not provided)'
          },
          targetProtein: {
            type: 'number',
            description: 'Daily protein target in grams'
          }
        }
      }
    },

    // =========================================================================
    // Write Tools
    // =========================================================================

    logCoachingNote: {
      name: 'log_coaching_note',
      description: 'Save a coaching insight or recommendation to the user\'s health record',
      parameters: {
        type: 'object',
        required: ['note', 'type'],
        properties: {
          note: {
            type: 'string',
            description: 'The coaching note or insight'
          },
          type: {
            type: 'string',
            enum: ['insight', 'recommendation', 'milestone', 'warning'],
            description: 'Type of coaching note'
          }
        }
      }
    }
  };

  /**
   * Create tools for agent use
   * @param {Object} context - Execution context with userId
   * @returns {Array<ITool>}
   */
  createTools(context) {
    const tools = [];
    const { userId } = context;

    // get_weight_trend
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.getWeightTrend,
      async ({ days = 30 }) => {
        const weightData = await this.#healthStore.loadWeightData(userId);
        const dates = Object.keys(weightData).sort().reverse().slice(0, days);

        const latest = weightData[dates[0]];
        const history = dates.map(date => ({
          date,
          lbs: weightData[date].lbs_adjusted_average,
          bodyFat: weightData[date].fat_percent_adjusted_average
        }));

        return {
          current: {
            lbs: latest?.lbs_adjusted_average,
            bodyFatPercent: latest?.fat_percent_adjusted_average,
            leanLbs: latest?.lbs_adjusted_average * (1 - latest?.fat_percent_adjusted_average / 100),
            trend: latest?.lbs_adjusted_average_7day_trend
          },
          history
        };
      }
    ));

    // get_today_nutrition
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.getTodayNutrition,
      async () => {
        const today = new Date().toISOString().split('T')[0];
        const items = await this.#nutriListStore.findByDate(userId, today);

        const totals = items.reduce((acc, item) => ({
          calories: acc.calories + (item.calories || 0),
          protein: acc.protein + (item.protein || 0),
          carbs: acc.carbs + (item.carbs || 0),
          fat: acc.fat + (item.fat || 0)
        }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

        return {
          date: today,
          totals,
          items: items.map(i => ({ name: i.name || i.item, calories: i.calories, protein: i.protein })),
          itemCount: items.length
        };
      }
    ));

    // get_nutrition_history
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.getNutritionHistory,
      async ({ days = 7 }) => {
        const nutritionData = await this.#healthStore.loadNutritionData(userId);
        const dates = Object.keys(nutritionData).sort().reverse().slice(0, days);

        return dates.map(date => ({
          date,
          calories: nutritionData[date]?.calories || 0,
          protein: nutritionData[date]?.protein || 0,
          carbs: nutritionData[date]?.carbs || 0,
          fat: nutritionData[date]?.fat || 0
        }));
      }
    ));

    // get_recent_workouts
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.getRecentWorkouts,
      async ({ days = 14 }) => {
        const [activityData, fitnessData] = await Promise.all([
          this.#healthStore.loadActivityData(userId),
          this.#healthStore.loadFitnessData(userId)
        ]);

        const workouts = [];
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        for (const [date, activities] of Object.entries(activityData)) {
          if (new Date(date) >= cutoff) {
            for (const activity of activities) {
              workouts.push({
                date,
                source: 'strava',
                type: activity.type,
                title: activity.title,
                duration: activity.minutes,
                calories: activity.calories,
                avgHr: activity.avgHeartrate
              });
            }
          }
        }

        return workouts.sort((a, b) => b.date.localeCompare(a.date));
      }
    ));

    // get_health_summary
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.getHealthSummary,
      async ({ date }) => {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const healthData = await this.#healthService.aggregateDailyHealth(userId, 1, new Date(targetDate));
        return healthData[targetDate] || { date: targetDate, noData: true };
      }
    ));

    // get_recent_meals
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.getRecentMeals,
      async ({ days = 7, minProtein }) => {
        const meals = [];
        const today = new Date();

        for (let i = 0; i < days; i++) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];

          const items = await this.#nutriListStore.findByDate(userId, dateStr);
          for (const item of items) {
            if (!minProtein || (item.protein && item.protein >= minProtein)) {
              meals.push({
                date: dateStr,
                name: item.name || item.item,
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat
              });
            }
          }
        }

        // Dedupe by name, keep most recent
        const seen = new Map();
        for (const meal of meals) {
          if (!seen.has(meal.name)) {
            seen.set(meal.name, meal);
          }
        }

        return Array.from(seen.values()).slice(0, 20);
      }
    ));

    // calculate_goal_progress
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.calculateGoalProgress,
      async ({ targetWeight, targetBodyFat }) => {
        const weightData = await this.#healthStore.loadWeightData(userId);
        const dates = Object.keys(weightData).sort().reverse();
        const latest = weightData[dates[0]];

        if (!latest) {
          return { error: 'No weight data available' };
        }

        const currentWeight = latest.lbs_adjusted_average;
        const currentBodyFat = latest.fat_percent_adjusted_average;
        const weeklyTrend = latest.lbs_adjusted_average_7day_trend;

        const result = {
          current: { weight: currentWeight, bodyFat: currentBodyFat },
          trend: { weekly: weeklyTrend }
        };

        if (targetWeight && weeklyTrend < 0) {
          const lbsToLose = currentWeight - targetWeight;
          const weeksToGoal = lbsToLose / Math.abs(weeklyTrend);
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() + weeksToGoal * 7);

          result.weightGoal = {
            target: targetWeight,
            remaining: lbsToLose,
            weeksToGoal: Math.round(weeksToGoal),
            estimatedDate: targetDate.toISOString().split('T')[0]
          };
        }

        if (targetBodyFat) {
          const leanMass = currentWeight * (1 - currentBodyFat / 100);
          const targetWeightForBodyFat = leanMass / (1 - targetBodyFat / 100);
          const lbsToLose = currentWeight - targetWeightForBodyFat;

          result.bodyFatGoal = {
            target: targetBodyFat,
            currentLeanMass: Math.round(leanMass * 10) / 10,
            weightAtTarget: Math.round(targetWeightForBodyFat * 10) / 10,
            lbsToLose: Math.round(lbsToLose * 10) / 10
          };
        }

        return result;
      }
    ));

    // suggest_calorie_target
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.suggestCalorieTarget,
      async ({ weeklyLossRate = 1.0 }) => {
        const weightData = await this.#healthStore.loadWeightData(userId);
        const dates = Object.keys(weightData).sort().reverse();
        const latest = weightData[dates[0]];

        if (!latest) {
          return { error: 'No weight data available' };
        }

        const weight = latest.lbs_adjusted_average;

        // Estimate BMR using Mifflin-St Jeor (assumes male, age 35, 5'10" as defaults)
        // In production, would pull from user profile
        const bmr = 10 * (weight / 2.205) + 6.25 * 178 - 5 * 35 + 5;
        const tdee = bmr * 1.4; // Light activity multiplier

        const dailyDeficit = (weeklyLossRate * 3500) / 7;
        const targetCalories = Math.round(tdee - dailyDeficit);
        const proteinTarget = Math.round(weight * 0.8); // 0.8g per lb

        return {
          bmrEstimate: Math.round(bmr),
          tdeeEstimate: Math.round(tdee),
          targetCalories,
          proteinTarget,
          weeklyDeficit: Math.round(dailyDeficit * 7),
          projectedWeeklyLoss: weeklyLossRate
        };
      }
    ));

    // calculate_remaining_macros
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.calculateRemainingMacros,
      async ({ targetCalories, targetProtein }) => {
        const today = new Date().toISOString().split('T')[0];
        const items = await this.#nutriListStore.findByDate(userId, today);

        const consumed = items.reduce((acc, item) => ({
          calories: acc.calories + (item.calories || 0),
          protein: acc.protein + (item.protein || 0)
        }), { calories: 0, protein: 0 });

        // Get targets if not provided
        let targets = { calories: targetCalories, protein: targetProtein };
        if (!targets.calories || !targets.protein) {
          const suggested = await this.createTools(context)
            .find(t => t.name === 'suggest_calorie_target')
            .execute({});
          targets.calories = targets.calories || suggested.targetCalories;
          targets.protein = targets.protein || suggested.proteinTarget;
        }

        return {
          consumed,
          targets,
          remaining: {
            calories: targets.calories - consumed.calories,
            protein: targets.protein - consumed.protein
          }
        };
      }
    ));

    // log_coaching_note
    tools.push(this.createTool(
      HealthToolFactory.TOOLS.logCoachingNote,
      async ({ note, type }) => {
        const today = new Date().toISOString().split('T')[0];
        const coachingData = await this.#healthStore.loadCoachingData(userId) || {};

        if (!coachingData[today]) {
          coachingData[today] = [];
        }

        const entry = {
          timestamp: new Date().toISOString(),
          type,
          note
        };

        coachingData[today].push(entry);
        await this.#healthStore.saveCoachingData(userId, coachingData);

        return { success: true, entry };
      }
    ));

    return tools;
  }
}

export default HealthToolFactory;
```

---

## Agent Definition

```javascript
// backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs

import { BaseAgent } from '../BaseAgent.mjs';

export class HealthCoachAgent extends BaseAgent {
  static id = 'health-coach';
  static name = 'Health Coach';
  static description = 'Proactive health accountability coach with nutrition, workout, and goal tracking';

  static capabilities = [
    'weight-trend-analysis',
    'nutrition-guidance',
    'workout-awareness',
    'goal-progress-tracking',
    'lifeplan-integration'
  ];

  /**
   * Get tools available to this agent
   * @param {Object} context - Execution context
   * @returns {Array<ITool>}
   */
  getTools(context) {
    return [
      ...this.toolFactories.health.createTools(context),
      ...this.toolFactories.lifeplan.createTools(context, {
        // Limited to health-related operations
        allowedActions: ['get_goals', 'get_quarterly_objectives', 'update_goal_progress']
      })
    ];
  }

  /**
   * Build context variables for system prompt
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async buildPromptContext(context) {
    const { userId } = context;
    const tools = this.getTools(context);

    // Gather data for prompt context
    const weightTool = tools.find(t => t.name === 'get_weight_trend');
    const nutritionTool = tools.find(t => t.name === 'get_today_nutrition');
    const workoutTool = tools.find(t => t.name === 'get_recent_workouts');

    const [weightData, nutritionData, workoutData] = await Promise.all([
      weightTool.execute({ days: 7 }),
      nutritionTool.execute({}),
      workoutTool.execute({ days: 7 })
    ]);

    const recentWorkouts = workoutData.slice(0, 3)
      .map(w => `${w.type} (${w.duration} min)`)
      .join(', ') || 'None recently';

    return {
      userName: context.userName || 'User',
      currentWeight: weightData.current?.lbs?.toFixed(1) || 'Unknown',
      bodyFatPercent: weightData.current?.bodyFatPercent?.toFixed(1) || 'Unknown',
      weeklyTrend: weightData.current?.trend?.toFixed(2) || '0',
      todayCalories: nutritionData.totals?.calories || 0,
      todayProtein: nutritionData.totals?.protein || 0,
      recentWorkoutSummary: recentWorkouts,
      healthGoal: context.healthGoal || 'Not set'
    };
  }
}

export default HealthCoachAgent;
```

---

## System Prompt

```javascript
// backend/src/3_applications/agents/health-coach/prompts/system.mjs

export const HEALTH_COACH_SYSTEM_PROMPT = `You are a supportive, data-driven health coach for {{userName}}.

## Your Role

You help {{userName}} achieve their health goals through accountability, insights, and practical guidance. You have access to their weight data, nutrition logs, workout history, and life goals.

## Personality

- **Encouraging but honest** — Celebrate wins, but don't sugarcoat when they're off track
- **Data-first** — Always ground advice in their actual numbers
- **Practical** — Suggest specific, actionable next steps
- **Respectful of autonomy** — You advise, they decide

## Current Stats

- Current weight: {{currentWeight}} lbs ({{bodyFatPercent}}% body fat)
- 7-day trend: {{weeklyTrend}} lbs/week
- Today's nutrition so far: {{todayCalories}} cal, {{todayProtein}}g protein
- Recent workouts: {{recentWorkoutSummary}}
- Health goal: {{healthGoal}}

## Guidelines

### Morning Check-ins

When greeting in the morning or when asked for a check-in, provide:

1. Weight trend update (are they on track?)
2. Yesterday's nutrition summary
3. Today's suggested calorie/protein targets
4. Workout suggestion if appropriate

Keep it concise — 3-4 sentences max.

### Nutrition Guidance

When asked about food or meals:

1. Calculate remaining macros for the day using calculate_remaining_macros
2. Suggest protein-forward options if they're behind on protein
3. Reference their recent meals using get_recent_meals when suggesting food
4. Never shame food choices — help them fit treats into targets

Example: "You have 800 cal and 55g protein left. Your salmon from yesterday would be perfect — 520 cal, 42g protein."

### Workout Awareness

- Note rest days after intense training
- Encourage movement on sedentary days
- Connect activity to calorie budget when relevant

Example: "Your 5K yesterday burned 320 cal. You could eat at maintenance today if you want."

### Goal Tracking

- Use calculate_goal_progress to provide concrete timelines
- Reference their Lifeplan health goal when relevant
- Suggest adjustments if they're significantly ahead or behind schedule

Example: "At -0.8 lbs/week, you'll hit 175 lbs by May 20 — two weeks early."

### What You Don't Do

- You don't log food for them (they use the Nutrition UI)
- You don't create detailed workout plans (just suggest general activity)
- You don't provide medical advice
- You don't guess at data — always use tools to get real numbers

## Response Style

- Keep responses concise (2-4 sentences for simple questions)
- Use specific numbers from the tools
- One clear recommendation per response unless asked for more
- Use occasional emoji sparingly (checkmarks, arrows) but don't overdo it

## Tool Usage

Always use tools to get current data. Don't assume or remember — data changes daily.

- Use get_weight_trend for weight questions
- Use get_today_nutrition for "how am I doing today" questions
- Use calculate_remaining_macros before suggesting meals
- Use get_recent_meals to personalize meal suggestions
- Use calculate_goal_progress for timeline questions
- Use log_coaching_note to record milestones and important insights
`;

export default HEALTH_COACH_SYSTEM_PROMPT;
```

---

## UI Integration

### Component Structure

```
frontend/src/modules/Health/
├── Health.jsx                  # Existing - weight dashboard
├── Health.scss                 # Existing
├── Nutrition.jsx               # Existing - nutrition overview
├── NutritionDay.jsx            # Existing - daily detail drawer
├── HealthCoach/
│   ├── HealthCoachPanel.jsx    # Collapsible coach panel
│   ├── HealthCoachPanel.scss   # Panel styles
│   ├── CoachMessage.jsx        # Individual message bubble
│   └── useHealthCoach.js       # Hook for coach API + state
```

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Health                                                    [💬] │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐           │
│  │ Weight  │ Comp    │ Trend   │ Cals    │ Goal    │           │
│  │ 182 lbs │ 22%     │ -0.8/wk │ +200    │ 45 days │           │
│  └─────────┴─────────┴─────────┴─────────┴─────────┘           │
│                                                                 │
│  [Weight Chart - 12 weeks]                                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Coach Panel (expanded)                                    [−]  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🏃 Morning check-in:                                        ││
│  │                                                             ││
│  │ You're down 0.8 lbs this week — right on target for 1 lb/  ││
│  │ week. Yesterday you hit 2,100 cal (150 under target) with  ││
│  │ 140g protein. Nice work on the protein.                    ││
│  │                                                             ││
│  │ Today: Aim for 2,250 cal, 145g protein. You did legs       ││
│  │ yesterday, so today's a good rest day or light cardio.     ││
│  │                                                             ││
│  │ ─────────────────────────────────────────────────────────  ││
│  │ [Ask coach something...]                            [Send] ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### useHealthCoach Hook

```javascript
// frontend/src/modules/Health/HealthCoach/useHealthCoach.js

import { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

export function useHealthCoach() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(() => {
    // Persist expansion state
    return localStorage.getItem('healthCoach.expanded') === 'true';
  });

  // Persist expansion state
  useEffect(() => {
    localStorage.setItem('healthCoach.expanded', isExpanded);
  }, [isExpanded]);

  // Load morning briefing on first expand
  useEffect(() => {
    if (isExpanded && messages.length === 0) {
      fetchMorningBriefing();
    }
  }, [isExpanded]);

  const fetchMorningBriefing = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await DaylightAPI('/api/v1/agents/health-coach/briefing');
      setMessages([{
        id: Date.now(),
        role: 'assistant',
        content: response.message,
        timestamp: new Date().toISOString()
      }]);
    } catch (error) {
      console.error('Failed to fetch briefing:', error);
      setMessages([{
        id: Date.now(),
        role: 'assistant',
        content: 'Having trouble connecting. Try again in a moment.',
        timestamp: new Date().toISOString(),
        error: true
      }]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (userMessage) => {
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const response = await DaylightAPI('/api/v1/agents/health-coach/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: userMessage,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: response.message,
        timestamp: new Date().toISOString()
      }]);
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: 'Sorry, I had trouble processing that. Try again?',
        timestamp: new Date().toISOString(),
        error: true
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isLoading,
    isExpanded,
    setIsExpanded,
    sendMessage,
    clearHistory,
    refreshBriefing: fetchMorningBriefing
  };
}

export default useHealthCoach;
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/agents/health-coach/briefing` | GET | Morning check-in with pre-filled context |
| `/api/v1/agents/health-coach/chat` | POST | Conversational interaction |

```javascript
// backend/src/4_api/v1/routers/agents/health-coach.mjs

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createHealthCoachRouter({ agentOrchestrator, logger = console }) {
  const router = express.Router();

  /**
   * GET /briefing
   * Get morning check-in briefing
   */
  router.get('/briefing', asyncHandler(async (req, res) => {
    const userId = req.user?.id || 'default';

    const result = await agentOrchestrator.execute({
      agentId: 'health-coach',
      input: 'Give me my morning health check-in.',
      context: { userId }
    });

    res.json({ message: result.output });
  }));

  /**
   * POST /chat
   * Conversational interaction
   */
  router.post('/chat', asyncHandler(async (req, res) => {
    const { message, history = [] } = req.body;
    const userId = req.user?.id || 'default';

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const result = await agentOrchestrator.execute({
      agentId: 'health-coach',
      input: message,
      history,
      context: { userId }
    });

    res.json({ message: result.output });
  }));

  return router;
}
```

---

## Implementation Phases

### Phase 1: Backend Foundation

- [ ] Create `HealthToolFactory` with read tools:
  - [ ] `get_weight_trend`
  - [ ] `get_today_nutrition`
  - [ ] `get_nutrition_history`
  - [ ] `get_recent_workouts`
  - [ ] `get_health_summary`
  - [ ] `get_recent_meals`
- [ ] Create `HealthCoachAgent` class
- [ ] Create system prompt template
- [ ] Add `/api/v1/agents/health-coach/briefing` endpoint
- [ ] Add `/api/v1/agents/health-coach/chat` endpoint

### Phase 2: Analysis Tools

- [ ] Implement `calculate_goal_progress` tool
- [ ] Implement `suggest_calorie_target` tool
- [ ] Implement `calculate_remaining_macros` tool
- [ ] Implement `log_coaching_note` tool
- [ ] Add coaching history persistence to `YamlHealthDatastore`

### Phase 3: Lifeplan Integration

- [ ] Connect `LifeplanToolFactory` with limited scope
- [ ] Add health goal context to briefings
- [ ] Enable agent to update goal progress
- [ ] Add goal milestone detection

### Phase 4: Frontend

- [ ] Create `HealthCoachPanel.jsx` component
- [ ] Create `CoachMessage.jsx` component
- [ ] Create `useHealthCoach.js` hook
- [ ] Create `HealthCoachPanel.scss` styles
- [ ] Integrate panel into `Health.jsx`
- [ ] Add expand/collapse with localStorage persistence

### Phase 5: Proactive Features

- [ ] Scheduled morning briefing generation (background job)
- [ ] Push notifications for milestones
- [ ] Webhook for weight data changes
- [ ] Weekly summary generation

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-02 | Initial design from brainstorming session |
