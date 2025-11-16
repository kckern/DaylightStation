import crypto from 'node:crypto';
import dotenv from 'dotenv';
import axios from 'axios';
import moment from 'moment-timezone';
import { v4 as uuidv4 } from 'uuid';
import { saveFile } from '../../lib/io.mjs';
import { getBase64Url } from '../../journalist/lib/food.mjs';

dotenv.config();

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.NUTRIBOT_GPT_MODEL ?? 'gpt-4o';
const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'America/Los_Angeles';
const MAX_CALLS_PER_MINUTE = Number(process.env.NUTRIBOT_GPT_RATE_LIMIT ?? 20);
const API_CALL_TRACKER = new Map();
const DEFAULT_COACH_THRESHOLDS = [400, 1000, 1600];
const DEFAULT_COACH_BUDGET = 2000;

export function createAIServices(options = {}) {
	const textAnalyzer = options.foodTextAnalyzer ?? createFoodTextAnalyzer(options);
	const visionAnalyzer = options.foodVisionAnalyzer ?? createFoodVisionAnalyzer(options);
	const itemizer = options.foodItemizer ?? createFoodItemizer(options);
	const classifier = options.foodClassifier ?? createFoodClassifier(options);
	const coach = options.coachService ?? createCoachService(options);
	const dailyCoach = options.dailyCoachService ?? createDailyCoachService(options);

	return {
		foodText: { analyze: textAnalyzer },
		foodVision: { analyze: visionAnalyzer },
		itemizer: { enrich: itemizer },
		classifier: { classify: classifier },
		coach: {
			respondToLog: coach.respondToLog,
			dailySummary: dailyCoach
		}
	};
}

function createFoodTextAnalyzer(options = {}) {
	const detectExtras = options.foodTextExtras ?? {};
	const maxAttempts = options.maxTextAttempts ?? 3;
	return async (text, extras = {}) => {
		const detection = await detectFoodFromTextDescription(
			text,
			{ ...detectExtras, ...extras },
			maxAttempts
		);
		const foodItems = Array.isArray(detection.food) ? detection.food : [];
		const items = foodItems.map((entry) => normalizeFoodEntry(entry));
		if (!items.length) {
			throw new Error('AI did not return any food items');
		}
		const usage = normalizeUsage(detection.usage);
		return {
			items,
			description: detection.description ?? text.trim(),
			usage,
			metadata: {
				requestId: detection.uuid ?? null,
				date: detection.date ?? null,
				time: detection.time ?? null
			}
		};
	};
}

function createFoodVisionAnalyzer(options = {}) {
	const detectExtras = options.foodVisionExtras ?? {};
	const maxAttempts = options.maxImageAttempts ?? 3;
	return async (imageUrl, extras = {}) => {
		const detection = await detectFoodFromImage(
			imageUrl,
			{ ...detectExtras, ...extras },
			maxAttempts
		);
		const foodItems = Array.isArray(detection.food) ? detection.food : [];
		if (!foodItems.length) {
			throw new Error('AI did not return any food items');
		}
		return {
			items: foodItems.map((entry) => normalizeFoodEntry(entry)),
			description: detection.description ?? null,
			usage: normalizeUsage(detection.usage),
			metadata: {
				requestId: detection.uuid ?? null,
				date: detection.date ?? null,
				time: detection.time ?? null
			}
		};
	};
}

function createFoodItemizer(options = {}) {
	const baseExtras = options.itemizerExtras ?? {};
	const maxAttempts = options.maxItemizerAttempts ?? 3;
	return async (foodList, extras = {}) => {
		const enriched = await itemizeFood(
			foodList,
			{ ...baseExtras, ...extras },
			maxAttempts
		);
		if (!enriched || !enriched.items?.length) {
			throw new Error('AI failed to itemize food list');
		}
		return enriched;
	};
}

function createFoodClassifier(options = {}) {
	const model = options.classifierModel ?? DEFAULT_MODEL;
	return async (item) => classifyFoodItem(item, model);
}

function createCoachService(options = {}) {
	const thresholds = options.coachThresholds ?? DEFAULT_COACH_THRESHOLDS;
	const dailyBudget = options.coachDailyBudget ?? DEFAULT_COACH_BUDGET;
	const model = options.coachModel ?? DEFAULT_MODEL;
	return {
		respondToLog: async (context = {}) =>
			generateCoachingMessage({
				thresholds,
				dailyBudget,
				model,
				...context
			})
	};
}

function createDailyCoachService(options = {}) {
	const model = options.dailyCoachModel ?? DEFAULT_MODEL;
	const maxTokens = options.dailyCoachMaxTokens ?? 1500;
	return async (history = []) => generateDailyHealthCoaching(history, { model, maxTokens });
}

async function detectFoodFromTextDescription(text, extras = {}, maxAttempts = 3, attempt = 1) {
	if (attempt > maxAttempts) {
		throw new Error('Too many attempts to detect food from text');
	}
	const { food_data, text: originalText, model } = extras;
	const { today } = getCurrentTimeDetails();
	const extraMessages = buildRevisionMessages(food_data, originalText, text);
	const payload = {
		model: model ?? DEFAULT_MODEL,
		messages: [
			{
				role: 'system',
				content: `You are nutrition reader. You read text descriptions of meals and snacks and process them like this:
				${getInstructions()}`
			},
			{
				role: 'user',
				content: [{ type: 'text', text: originalText || text }]
			},
			...extraMessages
		],
		max_tokens: 1000
	};

	try {
		const response = await gptCall(payload, 'nutribot.foodText');
		const description = response.choices?.[0]?.message?.content;
		const json = extractJSON(description);
		json.uuid = json.uuid ?? uuidv4();
		json.date = json.date || today;
		json.time = json.time || 'midday';
		json.food = json.food || [];
		json.usage = response.usage;
		return json;
	} catch (error) {
		console.error('Error describing text:', error?.shortMessage || error.message);
		return detectFoodFromTextDescription(text, extras, maxAttempts, attempt + 1);
	}
}

async function detectFoodFromImage(imgUrl, extras = {}, maxAttempts = 3, attempt = 1) {
	if (attempt > maxAttempts) {
		throw new Error('Too many attempts to detect food from image');
	}
	const { food_data, text: clarification, model } = extras;
	const extraMessages = buildVisionRevisionMessages(food_data, clarification);
	const payload = {
		model: model ?? DEFAULT_MODEL,
		messages: [
			{
				role: 'system',
				content: `You are nutrition seer. You look at images and process them like this:
				${getInstructions()}`
			},
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'This is my food.  What should I be logging?' },
					{ type: 'image_url', image_url: { url: imgUrl } }
				]
			},
			...extraMessages
		],
		max_tokens: 1000
	};

	try {
		const response = await gptCall(payload, 'nutribot.foodVision');
		const description = response.choices?.[0]?.message?.content;
		const json = extractJSON(description);
		const { today } = getCurrentTimeDetails();
		json.uuid = json.uuid ?? uuidv4();
		json.date = json.date || today;
		json.time = json.time || 'midday';
		json.food = json.food || [];
		json.usage = response.usage;
		return json;
	} catch (error) {
		console.error('Error describing image:', error?.shortMessage || error.message);
		return detectFoodFromImage(imgUrl, extras, maxAttempts, attempt + 1);
	}
}

function buildRevisionMessages(foodData, originalText, latestText) {
	if (!foodData || !originalText) {
		return [];
	}
	return [
		{ role: 'assistant', content: JSON.stringify(foodData) },
		{
			role: 'user',
			content: `The user has provided the following feedback on this JSON data: "${latestText}". Please make the appropriate adjustments.`
		}
	];
}

function buildVisionRevisionMessages(foodData, clarification) {
	if (!foodData || !clarification) {
		return [];
	}
	return [
		{ role: 'assistant', content: JSON.stringify(foodData) },
		{ role: 'user', content: 'Close, but needs some revisions based on clarifications from the user.' },
		{ role: 'assistant', content: 'What did this user say?' },
		{ role: 'user', content: `User clarification: "${clarification}"` },
		{ role: 'assistant', content: 'I see, I think I know what to change and adjust. Shall I proceed?' },
		{ role: 'user', content: 'Yes, revise the food list. Respond in pure JSON.' }
	];
}

function normalizeFoodEntry(entry) {
	const label = entry.item ?? entry.label ?? 'Unknown item';
	const grams = resolveGrams(entry);
	const color = (entry.noom_color ?? entry.color ?? 'orange').toLowerCase();
	const id = entry.id ?? entry.uuid ?? crypto.randomUUID();
	return {
		id,
		label,
		grams,
		color
	};
}

function resolveGrams(entry) {
	if (typeof entry.grams === 'number') {
		return entry.grams;
	}
	const amount = Number(entry.amount);
	if (!Number.isNaN(amount)) {
		const unit = typeof entry.unit === 'string' ? entry.unit.toLowerCase() : null;
		if (!unit || unit === 'g' || unit === 'gram' || unit === 'grams') {
			return amount;
		}
	}
	return Number.isNaN(amount) ? 0 : amount;
}

function normalizeUsage(raw) {
	if (!raw) {
		return {
			inputTokens: null,
			outputTokens: null,
			totalTokens: null
		};
	}
	return {
		inputTokens:
			raw.prompt_tokens ?? raw.input_tokens ?? raw.inputTokens ?? null,
		outputTokens:
			raw.completion_tokens ?? raw.output_tokens ?? raw.outputTokens ?? null,
		totalTokens: raw.total_tokens ?? raw.totalTokens ?? null
	};
}

async function itemizeFood(foodList = [], extras = {}, maxAttempts = 3, attempt = 1) {
	if (attempt > maxAttempts) {
		throw new Error('Too many attempts to itemize food');
	}
	const safeList = Array.isArray(foodList) && foodList.length ? foodList : sampleFoodList();
	const img = extras.image ?? extras.img;
	const instructions = `Take the given food list and expand the values of each item to include the following: calories, fat, carbs, protein, fiber, sugar, sodium, and cholesterol.

	Return only a JSON array, no commentary or markdown. Your output will be consumed by a backend processor using JSON.parse().

	Start every response with the character '[' to produce valid JSON array.`;
	const imgExtraMessages = img
		? [
			{ role: 'assistant', content: 'I see you included an image. Shall I describe the food in the image?' },
			{ role: 'user', content: 'No, simply use the image to inform your food itemization task as usual. Reply in JSON.' }
		]
		: [];
	const finalUserContent = await buildItemizerUserContent(safeList, img, attempt);
	const messages = [
		{ role: 'system', content: instructions },
		{
			role: 'user',
			content: JSON.stringify([
				{ icon: 'peanut_butter', item: 'Crunchy Peanut Butter', unit: 'g', amount: 60, noom_color: 'orange' },
				{ icon: 'cheddar', item: 'Colby Jack Cheddar Cheese', unit: 'g', amount: 64, noom_color: 'orange' }
			])
		},
		{
			role: 'assistant',
			content:
				'[ { "icon": "peanut_butter", "item": "Crunchy Peanut Butter", "unit": "g", "amount": 60, "noom_color": "orange", "calories": 340, "fat": 16, "carbs": 15, "protein": 18, "fiber": 3, "sugar": 7, "sodium": 250, "cholesterol": 0 }, { "icon": "cheddar", "item": "Colby Jack Cheddar Cheese", "unit": "g", "amount": 64, "noom_color": "orange", "calories": 220, "fat": 18, "carbs": 0, "protein": 14, "fiber": 0, "sugar": 0, "sodium": 360, "cholesterol": 60 } ]'
		},
		{
			role: 'user',
			content: JSON.stringify([
				{ icon: 'ramen', item: 'Korean Instant Ramen (Spicy)', unit: 'package', amount: 1, noom_color: 'orange' },
				{ icon: 'egg', item: 'Soft Boiled Egg', unit: 'g', amount: 50, noom_color: 'green' },
				{ icon: 'green_onion', item: 'Chopped Green Onion', unit: 'g', amount: 10, noom_color: 'green' },
				{ icon: 'seaweed', item: 'Dried Seaweed', unit: 'g', amount: 5, noom_color: 'green' },
				{ icon: 'kimchi', item: 'Kimchi', unit: 'g', amount: 50, noom_color: 'green' }
			])
		},
		{
			role: 'assistant',
			content:
				'[ { "icon": "ramen", "item": "Korean Instant Ramen (Spicy)", "unit": "package", "amount": 1, "noom_color": "orange", "calories": 500, "fat": 20, "carbs": 66, "protein": 10, "fiber": 3, "sugar": 3, "sodium": 1580, "cholesterol": 0 }, { "icon": "egg", "item": "Soft Boiled Egg", "unit": "g", "amount": 50, "noom_color": "green", "calories": 68, "fat": 5, "carbs": 1, "protein": 6, "fiber": 0, "sugar": 1, "sodium": 62, "cholesterol": 186 }, { "icon": "green_onion", "item": "Chopped Green Onion", "unit": "g", "amount": 10, "noom_color": "green", "calories": 3, "fat": 0.1, "carbs": 0.6, "protein": 0.2, "fiber": 0.2, "sugar": 0.2, "sodium": 1, "cholesterol": 0 }, { "icon": "seaweed", "item": "Dried Seaweed", "unit": "g", "amount": 5, "noom_color": "green", "calories": 17, "fat": 0, "carbs": 3, "protein": 2, "fiber": 0.5, "sugar": 0, "sodium": 87, "cholesterol": 0 }, { "icon": "kimchi", "item": "Kimchi", "unit": "g", "amount": 50, "noom_color": "green", "calories": 15, "fat": 1, "carbs": 2, "protein": 1, "fiber": 1, "sugar": 1, "sodium": 670, "cholesterol": 0 } ]'
		},
		{
			role: 'user',
			content: JSON.stringify([
				{ icon: 'steak', item: 'Grilled Sirloin Steak', unit: 'g', amount: 200, noom_color: 'orange' },
				{ icon: 'sweet_potato', item: 'Baked Sweet Potato', unit: 'g', amount: 150, noom_color: 'yellow' },
				{ icon: 'green_beans', item: 'Steamed Green Beans', unit: 'g', amount: 100, noom_color: 'green' },
				{ icon: 'red_wine', item: 'Red Wine', unit: 'ml', amount: 150, noom_color: 'yellow' }
			])
		},
		{
			role: 'assistant',
			content:
				'[ { "icon": "steak", "item": "Grilled Sirloin Steak", "unit": "g", "amount": 200, "noom_color": "orange", "calories": 366, "fat": 14, "carbs": 0, "protein": 58, "fiber": 0, "sugar": 0, "sodium": 122, "cholesterol": 153 }, { "icon": "sweet_potato", "item": "Baked Sweet Potato", "unit": "g", "amount": 150, "noom_color": "yellow", "calories": 135, "fat": 0.2, "carbs": 31, "protein": 2.5, "fiber": 5, "sugar": 6.5, "sodium": 72, "cholesterol": 0 }, { "icon": "green_beans", "item": "Steamed Green Beans", "unit": "g", "amount": 100, "noom_color": "green", "calories": 35, "fat": 0.1, "carbs": 8, "protein": 2, "fiber": 3.4, "sugar": 1.5, "sodium": 6, "cholesterol": 0 }, { "icon": "red_wine", "item": "Red Wine", "unit": "ml", "amount": 150, "noom_color": "yellow", "calories": 125, "fat": 0, "carbs": 3.8, "protein": 0.1, "fiber": 0, "sugar": 0.9, "sodium": 5, "cholesterol": 0 } ]'
		},
		{
			role: 'user',
			content: JSON.stringify([
				{ icon: 'egg', item: 'Scrambled Eggs', unit: 'g', amount: 100, noom_color: 'green' },
				{ icon: 'bacon', item: 'Bacon Strips', unit: 'g', amount: 50, noom_color: 'red' },
				{ icon: 'whole_wheat_bread', item: 'Whole Wheat Toast', unit: 'slice', amount: 2, noom_color: 'yellow' },
				{ icon: 'avocado', item: 'Sliced Avocado', unit: 'g', amount: 50, noom_color: 'green' },
				{ icon: 'orange_juice', item: 'Fresh Orange Juice', unit: 'ml', amount: 200, noom_color: 'yellow' }
			])
		},
		{
			role: 'assistant',
			content:
				'[ { "icon": "egg", "item": "Scrambled Eggs", "unit": "g", "amount": 100, "noom_color": "green", "calories": 150, "fat": 11, "carbs": 1, "protein": 13, "fiber": 0, "sugar": 1, "sodium": 142, "cholesterol": 372 }, { "icon": "bacon", "item": "Bacon Strips", "unit": "g", "amount": 50, "noom_color": "red", "calories": 250, "fat": 20, "carbs": 1, "protein": 17, "fiber": 0, "sugar": 0, "sodium": 1300, "cholesterol": 50 }, { "icon": "whole_wheat_bread", "item": "Whole Wheat Toast", "unit": "slice", "amount": 2, "noom_color": "yellow", "calories": 140, "fat": 2, "carbs": 28, "protein": 6, "fiber": 4, "sugar": 4, "sodium": 280, "cholesterol": 0 }, { "icon": "avocado", "item": "Sliced Avocado", "unit": "g", "amount": 50, "noom_color": "green", "calories": 80, "fat": 7, "carbs": 4, "protein": 1, "fiber": 3, "sugar": 0, "sodium": 0, "cholesterol": 0 }, { "icon": "orange_juice", "item": "Fresh Orange Juice", "unit": "ml", "amount": 200, "noom_color": "yellow", "calories": 94, "fat": 0.2, "carbs": 21, "protein": 1.7, "fiber": 0.4, "sugar": 17, "sodium": 2, "cholesterol": 0 } ]'
		},
		{
			role: 'user',
			content: finalUserContent
		},
		...imgExtraMessages
	];
	const payload = {
		model: extras.model ?? DEFAULT_MODEL,
		messages,
		max_tokens: 4096
	};

	try {
		const response = await gptCall(payload, 'nutribot.itemizer');
		const content = response.choices?.[0]?.message?.content ?? '[]';
		const normalized = sanitizeItemizerOutput(content);
		if (!normalized.length) {
			console.error('No JSON data returned from itemizer');
			return itemizeFood(foodList, extras, maxAttempts, attempt + 1);
		}
		return {
			items: normalized,
			usage: normalizeUsage(response.usage),
			requestId: response.id ?? null
		};
	} catch (error) {
		console.error('Error itemizing food:', error?.shortMessage || error.message);
		return itemizeFood(foodList, extras, maxAttempts, attempt + 1);
	}
}

async function buildItemizerUserContent(foodList, img, attempt) {
	if (!img || attempt > 1) {
		return JSON.stringify(foodList);
	}
	const isDataUrl = typeof img === 'string' && img.startsWith('data:');
	const imageUrl = isDataUrl ? img : await getBase64Url(img);
	return [
		{ type: 'text', text: JSON.stringify(foodList) },
		{ type: 'image_url', image_url: { url: imageUrl } }
	];
}

function sanitizeItemizerOutput(content) {
	const trimmed = content.replace(/^[^\[]+/s, '').replace(/[^\]]+$/s, '').trim() || '[]';
	const parsed = extractJSON(trimmed);
	const items = Array.isArray(parsed) ? parsed : [];
	const validKeys = [
		'uuid',
		'icon',
		'item',
		'unit',
		'amount',
		'noom_color',
		'calories',
		'fat',
		'carbs',
		'protein',
		'fiber',
		'sugar',
		'sodium',
		'cholesterol',
		'chat_id',
		'date',
		'timeofday',
		'log_uuid'
	];
	const substitutions = {
		color: 'noom_color',
		time: 'timeofday',
		cal: 'calories',
		calories_total: 'calories',
		carbohydrates: 'carbs',
		sugars: 'sugar',
		sodiums: 'sodium',
		cholesterols: 'cholesterol',
		fats: 'fat',
		proteins: 'protein',
		fibers: 'fiber'
	};
	return items.map((item) => {
		const next = { ...item };
		next.uuid = next.uuid ?? uuidv4();
		Object.entries(substitutions).forEach(([from, to]) => {
			if (next[from] !== undefined && next[to] === undefined) {
				next[to] = next[from];
			}
			delete next[from];
		});
		Object.keys(next).forEach((key) => {
			if (!validKeys.includes(key)) {
				delete next[key];
			}
		});
		return next;
	});
}

function sampleFoodList() {
	return [
		{ icon: 'peanut_butter', item: 'Crunchy Peanut Butter', unit: 'g', amount: 60, noom_color: 'orange' },
		{ icon: 'cheddar', item: 'Colby Jack Cheddar Cheese', unit: 'g', amount: 64, noom_color: 'orange' }
	];
}

async function classifyFoodItem(item, model = DEFAULT_MODEL) {
	const noomColors = ['green', 'yellow', 'orange'];
	const messages = [
		{
			role: 'system',
			content: `You are food classifier. You classify food items into one of the following noom colors: ${noomColors.join(
				', '
			)}. You also provide an icon for the food item, based on the item name. Valid icons are: ${icons.split(' ').join(', ')}. Always respond in JSON, keys: { item, noom_color, icon }`
		},
		{ role: 'user', content: 'Celery Stick (100g)' },
		{ role: 'assistant', content: JSON.stringify({ item: 'Celery Stick', noom_color: 'green', icon: 'celery' }) },
		{ role: 'user', content: 'Burrito (250g)' },
		{ role: 'assistant', content: JSON.stringify({ item: 'Burrito', noom_color: 'orange', icon: 'burrito' }) },
		{ role: 'user', content: 'Chocolate Chip Cookie (50g)' },
		{ role: 'assistant', content: JSON.stringify({ item: 'Chocolate Chip Cookie', noom_color: 'orange', icon: 'cookie' }) },
		{ role: 'user', content: 'Brown Rice (150g)' },
		{ role: 'assistant', content: JSON.stringify({ item: 'Brown Rice', noom_color: 'yellow', icon: 'rice' }) },
		{ role: 'user', content: 'Spinach (100g)' },
		{ role: 'assistant', content: JSON.stringify({ item: 'Spinach', noom_color: 'green', icon: 'spinach' }) },
		{ role: 'user', content: 'Miracle Whip (50g)' },
		{ role: 'assistant', content: JSON.stringify({ item: 'Miracle Whip', noom_color: 'orange', icon: 'mayonnaise' }) },
		{ role: 'user', content: item }
	];
	const payload = {
		model,
		messages,
		max_tokens: 150
	};
	try {
		const response = await gptCall(payload, 'nutribot.classifier');
		const result = extractJSON(response.choices?.[0]?.message?.content || '{}');
		if (!result.item || !result.noom_color || !result.icon) {
			console.error('Failed to classify item:', item, result);
			return fallbackClassification(item);
		}
		return result;
	} catch (error) {
		console.error('Error classifying item:', error?.shortMessage || error.message);
		return fallbackClassification(item);
	}
}

function fallbackClassification(item) {
	return {
		item: item.replace(/\s*\([^)]*\)\s*$/g, ''),
		noom_color: 'yellow',
		icon: 'default'
	};
}

async function generateCoachingMessage(context = {}) {
	const thresholds = context.thresholds ?? DEFAULT_COACH_THRESHOLDS;
	const dailyBudget = context.dailyBudget ?? DEFAULT_COACH_BUDGET;
	const todaysDate = context.date ?? moment().tz(DEFAULT_TIMEZONE).format('YYYY-MM-DD');
	const todaysItems = context.todaysItems ?? [];
	const newFood = context.newFood ?? [];
	const todaysTotalCalories = context.todaysTotalCalories ?? sumCalories(todaysItems);
	const recentCalories = context.recentCalories ?? sumCalories(newFood);
	const previousCalories = context.previousCalories ?? Math.max(todaysTotalCalories - recentCalories, 0);
	const remainingCalories = dailyBudget - todaysTotalCalories;
	const crossedThreshold = thresholds.find((threshold) => previousCalories < threshold && todaysTotalCalories >= threshold) ?? null;
	const payload = buildCoachPayload({
		crossedThreshold,
		todaysTotalCalories,
		remainingCalories,
		recentCalories,
		newFood,
		model: context.model ?? DEFAULT_MODEL
	});

	try {
		const response = await gptCall(payload, 'nutribot.coach');
		const message = response.choices?.[0]?.message?.content?.trim();
		return {
			message: message || buildCoachFallback(crossedThreshold, remainingCalories),
			usage: normalizeUsage(response.usage),
			requestId: response.id ?? null,
			crossedThreshold,
			date: todaysDate
		};
	} catch (error) {
		console.error('Error getting GPT coaching message:', error?.shortMessage || error.message);
		return {
			message: buildCoachFallback(crossedThreshold, remainingCalories),
			usage: {
				inputTokens: null,
				outputTokens: null,
				totalTokens: null
			},
			requestId: null,
			crossedThreshold,
			date: todaysDate
		};
	}
}

function buildCoachPayload({ crossedThreshold, todaysTotalCalories, remainingCalories, recentCalories, newFood, model }) {
	const recentSummary = newFood.map(formatFoodSnippet);
	if (crossedThreshold) {
		return {
			model,
			messages: [
				{
					role: 'system',
					content: `You are a supportive nutrition coach providing milestone celebration messages when users cross calorie thresholds.
				The user just crossed the ${crossedThreshold} calorie threshold for the day.
				Provide a 2-3 sentence encouraging message that:
				- Acknowledges this milestone
				- Provides appropriate guidance for their current calorie level
				- Maintains a positive, supportive tone

				Their daily total is now ${todaysTotalCalories} calories.
				They have ${remainingCalories > 0 ? `${remainingCalories} calories remaining` : `exceeded their budget by ${Math.abs(remainingCalories)} calories`} in their daily budget.`
				},
				{
					role: 'user',
					content: `I just crossed the ${crossedThreshold} calorie threshold. My daily total is now ${todaysTotalCalories} calories. Recent foods: ${JSON.stringify(recentSummary)}`
				}
			],
			max_tokens: 1500
		};
	}
	return {
		model,
		messages: [
			{
				role: 'system',
				content: `You are a supportive nutrition coach providing brief, encouraging responses to food logging.
			Keep responses to 1 sentence or a short phrase. Be positive and motivating.
			The user has logged ${recentCalories} calories just now, bringing their daily total to ${todaysTotalCalories} calories.
			They have ${remainingCalories > 0 ? `${remainingCalories} calories remaining` : `exceeded their budget by ${Math.abs(remainingCalories)} calories`}.
			Respond appropriately to their current situation with a brief, encouraging message.`
			},
			{
				role: 'user',
				content: `Most recent food items logged: ${JSON.stringify(recentSummary)}. Today's total so far: ${todaysTotalCalories} calories.`
			}
		],
		max_tokens: 1000
	};
}

function buildCoachFallback(threshold, remainingCalories) {
	if (!threshold) {
		const fallbackMessages = [
			"Good job logging that!",
			'Thanks for keeping track!',
			'Nice choice!',
			'Keep it up!',
			'Great logging!'
		];
		return fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
	}
	switch (threshold) {
		case 400:
			return "Great start to your day! You've hit 400 calories - a solid foundation. Keep focusing on nutrient-dense foods to fuel your body well.";
		case 1000:
			return "You're now at 1000 calories for the day - well into your nutritional stride! Stay mindful of the remaining budget.";
		case 1600:
			return "You've reached 1600 calories today. Take a moment to assess your hunger and consider lighter options for the rest of the day.";
		default:
			return `Great milestone! You've reached ${threshold} calories today with ${remainingCalories} remaining.`;
	}
}

function formatFoodSnippet(item) {
	const amount = item.amount ?? item.quantity ?? '';
	const unit = item.unit ?? item.units ?? '';
	return `${item.item ?? item.label ?? 'Food'} (${amount}${unit})`;
}

async function generateDailyHealthCoaching(history = [], options = {}) {
	if (!history.length) {
		throw new Error('Daily health coaching requires at least one history entry');
	}
	const messages = [
		{ role: 'system', content: DAILY_HEALTH_INSTRUCTIONS },
		...history.map((entry) => {
			if (entry?.role && entry?.content) {
				return entry;
			}
			return { role: 'user', content: JSON.stringify(entry) };
		})
	];
	const payload = {
		model: options.model ?? DEFAULT_MODEL,
		messages,
		max_tokens: options.maxTokens ?? 1500
	};
	const response = await gptCall(payload, 'nutribot.coach.daily');
	const content = response.choices?.[0]?.message?.content || '{}';
	const summary = extractJSON(content);
	return {
		plan: summary,
		usage: normalizeUsage(response.usage),
		requestId: response.id ?? null
	};
}

function sumCalories(items = []) {
	return items.reduce((total, item) => total + Number.parseInt(item?.calories ?? 0, 10), 0);
}

function gptCall(payload, scope = 'nutribot.default') {
	return throttledCall(scope, async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error('Missing OPENAI_API_KEY environment variable');
		}
		const response = await axios.post(OPENAI_ENDPOINT, payload, {
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			timeout: 60000
		});
		const month = moment().tz(DEFAULT_TIMEZONE).format('YYYY-MM');
		saveFile(`gpt/nutribot/${month}/${Date.now()}`, { in: payload, out: response.data });
		return response.data;
	});
}

function throttledCall(key, fn) {
	if (isRateLimited(key)) {
		throw new Error(`Rate limit exceeded for ${key}`);
	}
	return fn();
}

function isRateLimited(key) {
	const now = Date.now();
	const windowStart = now - 60000;
	const calls = API_CALL_TRACKER.get(key) ?? [];
	const recentCalls = calls.filter((timestamp) => timestamp > windowStart);
	if (recentCalls.length >= MAX_CALLS_PER_MINUTE) {
		API_CALL_TRACKER.set(key, recentCalls);
		return true;
	}
	recentCalls.push(now);
	API_CALL_TRACKER.set(key, recentCalls);
	return false;
}

export {
	detectFoodFromTextDescription,
	detectFoodFromImage,
	itemizeFood,
	classifyFoodItem as getIconAndNoomColorFromItem,
	generateCoachingMessage,
	generateDailyHealthCoaching
};

const icons = `almond apple_sauce apple artichoke asparagus avocado bacon bagel baguette baked_beans bamboo banana bananapepper bar beef beer beet biscuit biscuitcracker black_bean black_olive blackberry blueberry_bagel blueberry breadsticks breakfast breakfastsandwich broccoli brown_spice brown_sugar brownie brussels_sprout burrito butter cabbage cake calamari calories candy candybar carrot_cupcake carrot cashew casserole cauliflower celery cereal_bar cereal cheese cheesecake cherry chestnut chicken_wing chicken chickentenders chickpea chocolate_chip_bagel chocolate_frosting chocolate_milk_shake chocolate chocolatechip chocolatechips christmas_cookie churro cider cinnamon_roll clam coconut coffee coleslaw cookie corn cornbread cottage_cheese crab cracker cranberry cream croissant crouton cucumber cupcake curry date default deli_meat dinner_roll dish donut dumpling eclair egg_roll egg eggplant enchilada falafel fern fig filbert fish fowl french_fries french_toast fritter fruit_cocktail fruit_leather game garlic gobo_root gourd graham_cracker grain grapefruit grapes green_bean green_bell_pepper green_dip green_olive green_spice grilled_cheese guava gummybear hamburger_bun hamburger_patty hamburger hash hazelnut honey horseradish hot_dog_bun hot_dog hotpot ice_cream_bar ice_cream_sandwich ice_cream iced_coffee iced_tea jam jicama juice kale kebab ketchup kiwi lamb lasagna latte leeks lemon lemonade lime lobster macadamia macandcheese mango marshmallow mayonnaise meatballs melon milk_shake milk mixed_drink mixed_nuts molassescookie muffin mushroom mustard nigirisushi oatmeal octopus oil okra omelette onion orange_juice orange orangechicken pancakes papaya parfait parsnip pasta pastry pattysandwich pavlova peach peanut_butter peanut pear peas pecan peppers persimmon pickle pie_apple pie pill pine_nut pineapple pistachio pitasandwich pizza plum pocky pomegranate popcorn popsicle pork porkchop pot_pie potato_chip potato_salad potato powdereddrink prawn pretzel prune pudding pumpkin quesadilla quiche radish raisin ranch_dressing raspberry ravioli red_bean red_bell_pepper red_dip red_spice red_velvet_cookie red_wine relish rhubarb ribs rice_cake rice roll romaine salad salt sandwich sauce sausage seaweed seed sesame_bagel shallot shrimp smoothie snack snap_bean soft_drink souffle soup sour_cream soy_nut soysauce spaghetti_squash spinach springroll sprouts squash starfruit stewbrown stewyellow stir_fry stirfrynoodles strawberry_milk_shake strawberry stuffing sub_sandwich sugarcookie sushi syrup taco taro tater_tots tea tempura toast toaster_pastry tofu tomato tomatosoup tortilla_chip tortilla tostada turkey turnip turnover vanilla_cupcake vegetable waffles walnut water_chestnut water watermelon white_bean white_bread white_sugar white_wine wrap yam yellow_bell_pepper yellow_drink yellow_frosting yellow_spice yogurt zucchini`.replace(/\n/g, ' ');

function getInstructions() {
	const { today, dayOfWeek, timeAMPM, timezone, unix, momentTimezone, time } = getCurrentTimeDetails();
	return `List the food items in them, output in a JSON object which contains keys:
		- "food" an array with the food icon, item name, amount (integer), and unit (g, ml, etc.), and noom color (green, yellow, orange).
		- "date," the date of the meal.  Usually the current date (today is ${dayOfWeek}, ${today} at ${timeAMPM}, TZ: ${timezone} (${momentTimezone}), unix time: ${unix} ), but could be in the past, if the description mentions a timeframe, such as "yesterday" or "on wednesday".  If the date is already specified in a previous attempt, keep that one, unless the user specifies a new date.
		- "time," the time of the meal.  Usually "midday" or "evening", but could be "morning" or "night".  Default is "${time}", unless the user specifies a different time for the meal.

		Additional instructions:
		 - Markdown output is prohibited
		 - Consumer is a backend processor without markdown render environment
		 - you are communicating with an API, not a user
		 - Begin all AI responses with the character '{' to produce valid JSON
		 - Assume that each food item string will be used to search for nutrition information in a database.
		 - Therefore, avoid parenthes, compound "or" statements, and other non-general words that would compromise the search.
		 - "item" is not a unit; estimate the amount in grams, milliliters, or other standard units.
		 - You are welcome to name brands if you can identify them.
		 - Ignore items in the background or the periphery of the image.
		 - Do not include any commentary, just JSON data.
		 - Sort the food items so that the largest portion is first, the second largest is second, smallest is last, etc.

		 - Noom colors are: green, yellow, orange.
		 - Food icon must be selected from one of the following: ${icons}`;
}

function getCurrentTimeDetails() {
	const timezone = DEFAULT_TIMEZONE;
	const today = moment().tz(timezone).format('YYYY-MM-DD');
	const dayOfWeek = moment().tz(timezone).format('dddd');
	const timeAMPM = moment().tz(timezone).format('h:mm a');
	const hourOfDayInt = parseInt(moment().tz(timezone).hour(), 10);
	const unix = moment().tz(timezone).unix();
	const momentTimezone = moment.tz.guess();
	const time = hourOfDayInt < 12 ? 'morning' : hourOfDayInt < 17 ? 'midday' : hourOfDayInt < 21 ? 'evening' : 'night';
	return { today, timezone, dayOfWeek, timeAMPM, hourOfDayInt, unix, momentTimezone, time };
}

function extractJSON(openaiResponse) {
	if (!openaiResponse || typeof openaiResponse !== 'string') {
		console.error('extractJSON received invalid response:', typeof openaiResponse, openaiResponse);
		return {};
	}
	const jsonString = openaiResponse.replace(/^[^{\[]*/s, '').replace(/[^}\]]*$/s, '').trim();
	if (!jsonString) {
		console.error('extractJSON: No JSON content found in response');
		return {};
	}
	try {
		return JSON.parse(jsonString);
	} catch (error) {
		console.error('Failed to parse JSON:', error.message);
		console.error('Cleaned JSON string:', jsonString);
		console.error('Original response:', openaiResponse);
		return {};
	}
}

const DAILY_HEALTH_INSTRUCTIONS = `You are a supportive nutrition and health coach providing daily summary messages based on the user's food intake and health data.
Each day, you receive a JSON object with the following keys:
- date: The date of the log entry (YYYY-MM-DD)
- lbs: The user's weight in pounds
- fat_percent: The user's body fat percentage
- weekly_delta: The change in weight over the past week
- calorie_balance: The net calorie balance for the day (calories consumed - calories burned)
- calories: Total calories consumed
- protein: Total protein consumed (grams)
- carbs: Total carbohydrates consumed (grams)
- fat: Total fat consumed (grams)
- fiber: Total fiber consumed (grams)
- sodium: Total sodium consumed (mg)
- sugar: Total sugar consumed (grams)
- cholesterol: Total cholesterol consumed (mg)
- food_items: An array of strings describing the food items consumed, each prefixed with a colored circle indicating its Noom color (🟢 green, 🟡 yellow, 🟠 orange)
- steps: Total steps taken
- workouts: An array of strings describing the workouts performed, including duration and calories burned
Your task is to generate coaching messages in a JSON object with the following format:
{
	"date": "2024-04-01",
	"nutrition": {
		"observation": "Your calorie deficit has been consistent, averaging -500 calories per day over the past week, but your protein intake is slightly below the recommended 100g.",
		"guidance": "Find ways to increase protein intake, such as adding a protein shake or lean meats to your meals."
	},
	"weight_and_composition": {
		"observation": "Your weight is stable at 180.5 lbs with a slight decrease in body fat to 23.96%.",
		"guidance": "Watch out for small weight gains; consider adjusting your calorie intake or increasing activity."
	},
	"fitness_and_activity": {
		"observation": "You averaged 10,000 steps per day and completed 3 workouts this week, burning an average of 200 calories per session.",
		"guidance": "Given your calorie deficit, keep the cardio light and focus on strength training to preserve muscle mass."
	},
	"overall": {
		"observation": "Overall, you're making good progress with a consistent calorie deficit and stable weight.",
		"guidance": "Keep up the good work, but focus on hitting your protein targets and maintaining muscle mass."
	},
}, {
	"date": "2024-04-02",
	"nutrition": {
		"observation": "The smoothie you had was a great choice, especially with the added spinach and chia seeds, it helped you keep your fiber intake up, and calories under 1500.",
		"guidance": "If this meal suits you, consider making it a regular part of your diet."
	},
	"weight_and_composition": {
		"observation": "Trends are stable, but rate of change is slowing.",
		"guidance": "It's probably just water weight, so go easy on the sodium and carbs, like that pasta dish you had last night—probably not the best choice."
	},
	"fitness_and_activity": {
		"observation": "The cardio session probably felt good, but it didn't dent your calorie balance much. Remember, abs are made in the kitchen.",
		"guidance": "Keep the cardio light and focus on strength training to preserve muscle mass. Flexibility and balance work are also good options."
	},
	"overall": {
		"observation": "You've finally hit a consistent calorie deficit, and the scale is moving in the right direction.",
		"guidance": "Keep up the good work, but focus on hitting your protein targets and maintaining muscle mass."
	}
}
Tips:
- Use a positive, supportive tone, but call out bad choices or concerning trends.
- Be specific in your observations, not just numbers, but food choices and exercise habits.
- Infer meals based on food items.
- Be specific about workouts, but speak conversationally.
- Consider already-provided coaching messages in the conversation history to maintain continuity and avoid repetition.`;
